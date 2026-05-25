import { CONFIG } from "/js/base/config.js";

const CONNECTOR_VER = 0;
const SEND_BUF_SIZE = 0xffff;

const PACKET_TYPES = {
  SOCKET_CONNECT: 0,
  DISCONNECT: 1,
  CONNECT: 2,
  OPEN: 3,
  CACHE_UPDATE: 4,
  SPACE_INFO: 5,
  CONTROLS: 6,
  VIEW: 7,
};

const CONNECTOR_OFFSETS = {
  packetType: 0, // 2
  _totalBytes: 2,
};

const STATUS = {
  DISCONNECTED: 0,
  CONNECTING: 1,
  CONNECTED: 2,
  OPEN: 3,
};

const MODES = {
  SERVER: 0,
  CLIENT: 1,
};

const CACHE_MODES = {
  SPACE_INFO: MODES.SERVER,
  VIEW: MODES.SERVER,
};

for (let key in PACKET_TYPES) {
  PACKET_TYPES[PACKET_TYPES[key]] = key;
}
for (let key in CACHE_MODES) {
  CACHE_MODES[PACKET_TYPES[key]] = CACHE_MODES[key];
}

class CerealConnection {
  constructor(cnt) {
    this.cnt = cnt;
    this.packetCache = {};
    this.sendCacheAmounts = {};

    this.status = STATUS.CONNECTING;

    this.diff = new Uint8Array(SEND_BUF_SIZE);
    this.diffView = new DataView(this.diff.buffer);

    this.sendReliable = () => {
      console.warn("No send function assigned");
    };
    this.sendUnreliable = () => {
      console.warn("No send function assigned");
    };
    this.close = () => {
      console.warn("No close function assinged");
    };

    this._openQueue = [];
  }

  setSendReliable(func) {
    this.sendReliable = func;
  }

  setSendUnreliable(func) {
    this.sendUnreliable = func;
  }

  setClose(func) {
    this.close = func;
  }

  processSendCache(type, newPacket) {
    const needsFullRefresh =
      this.packetCache[type] === undefined ||
      this.sendCacheAmounts[type]++ >
        CONFIG.CerealConnector.cacheStateRefreshAmount;

    if (needsFullRefresh) {
      // Initialize or resize the cache view safely
      const cacheBuf =
        this.packetCache[type]?.buffer || new ArrayBuffer(SEND_BUF_SIZE);
      this.packetCache[type] = new Uint8Array(
        cacheBuf,
        0,
        newPacket.byteLength,
      );
      this.packetCache[type].set(newPacket, 0);

      this.sendCacheAmounts[type] = 0;
      return false; // Tells _processSendData to send the full packet
    }

    const cachePacket = this.packetCache[type];
    const oldLen = cachePacket.length;
    const newLen = newPacket.byteLength;
    const loopLen = Math.max(oldLen, newLen);

    let dvIndex = 6;
    const dv = this.diffView;
    dv.setUint16(0, type, true);
    dv.setUint32(2, newLen, true);

    const MAX_GAP = 10;
    let gap = 0;
    let startIndex = -1;

    for (let i = 0; i < loopLen; i++) {
      const isDifferent = i >= oldLen || cachePacket[i] !== newPacket[i];

      if (isDifferent) {
        if (startIndex === -1) startIndex = i;
        gap = 0;
      } else {
        if (startIndex !== -1) {
          gap++;
          if (gap === MAX_GAP) {
            const endIndex = i - gap + 1;
            const chunkLen = endIndex - startIndex;

            dv.setUint32(dvIndex, startIndex, true);
            dv.setUint32(dvIndex + 4, chunkLen, true);
            this.diff.set(
              newPacket.subarray(startIndex, endIndex),
              dvIndex + 8,
            );

            dvIndex += 8 + chunkLen;
            startIndex = -1;
            gap = 0;
          }
        }
      }
    }

    if (startIndex !== -1) {
      const endIndex = newLen - (newLen < oldLen ? 0 : gap);
      const chunkLen = Math.max(0, endIndex - startIndex);

      if (chunkLen > 0) {
        dv.setUint32(dvIndex, startIndex, true);
        dv.setUint32(dvIndex + 4, chunkLen, true);
        this.diff.set(newPacket.subarray(startIndex, endIndex), dvIndex + 8);
        dvIndex += 8 + chunkLen;
      }
    }

    this.packetCache[type] = new Uint8Array(cachePacket.buffer, 0, newLen);
    this.packetCache[type].set(newPacket, 0);

    return this.diff.subarray(0, dvIndex);
  }

  processReceiveCache(diffPacket, dv) {
    let i = 0;
    const type = dv.getUint16(i, true);
    i += 2;
    const len = dv.getUint32(i, true);
    i += 4;
    let cachePacket = this.packetCache[type];
    if (cachePacket === undefined) {
      throw new Error(
        `No packet cache created for type "${type}" on connection "${this}"`,
      );
    }

    this.packetCache[type] = cachePacket = new Uint8Array(
      cachePacket.buffer,
      0,
      len,
    );

    while (i < diffPacket.byteLength) {
      const index = dv.getUint32(i, true);
      i += 4;
      const eLen = dv.getUint32(i, true);
      i += 4;
      cachePacket.set(diffPacket.subarray(i, i + eLen), index);
      i += eLen;
    }
    return [type, cachePacket];
  }

  onOpen(func) {
    if (this.status === STATUS.OPEN) {
      func();
    } else {
      this._openQueue.push(func);
    }
  }
}

let serverSignalingWs = undefined;
const serverPeers = new Map(); // Should be fine since IDS should be unique
let serverReconTime = 5000;
class CerealPeer {
  constructor(mode, targetPeerId, worker = undefined) {
    this.id = crypto.randomUUID();
    this.mode = mode;

    this.peer;
    this.EXPECTED_DATA_CHANNELS = 2; // onOpen only fires once this is met
    this.dataChannels = [];

    this.targetPeerId = targetPeerId;

    this.worker = worker;
    if (this.mode === MODES.SERVER && this.worker instanceof Worker === false) {
      throw new Error("Server peers must have a valid Worker");
    }

    this.ws;
    this.iceServers = CONFIG.CerealConnector.iceServers;
    if (this.mode === MODES.SERVER) {
      if (serverSignalingWs === undefined) {
        this.ws = serverSignalingWs = this._makeWsConnection();
      } else {
        this.ws = serverSignalingWs;
      }
      this.ws.addEventListener("newCon", () => {
        this.ws = serverSignalingWs;
      });
    } else if (this.mode === MODES.CLIENT) {
      this.ws = this._makeWsConnection();
    }

    this.hasOpened = false;
    this.hasClosed = false;
    this._customCloses = [];
    this._customMessages = [];
    this._customOpens = [];
    this._wsOpenCustoms = [];
  }

  setUpDataChannel(dc) {
    console.log("Adding data channel", dc.label);
    this.dataChannels.push(dc);
    dc.bufferedAmountLowThreshold = 32768;
    dc._sendQueue = [];

    dc.addEventListener("bufferedamountlow", () => {
      console.log("Draining back preasure");
      while (
        dc._sendQueue.length > 0 &&
        dc.bufferedAmount < dc.bufferedAmountLowThreshold
      ) {
        const payload = dc._sendQueue.shift();
        try {
          dc.send(payload);
        } catch (err) {
          console.error(`Error flushing queue on channel ${dc.label}:`, err);
          break;
        }
      }
    });

    dc.addEventListener("message", (e) => {
      if (this.hasOpened === false) {
        this.onOpen(() => {
          for (let func of this._customMessages) {
            func(e);
          }
        });
        return;
      }
      for (let func of this._customMessages) {
        func(e);
      }
    });

    dc.addEventListener("open", (e) => {
      if (this.dataChannels.length !== this.EXPECTED_DATA_CHANNELS) return;

      for (let chan of this.dataChannels) {
        if (chan.readyState !== "open") return;
      }

      this.hasOpened = true;
      for (let func of this._customOpens) {
        func();
      }
    });
  }

  sendReliable(data) {
    for (let channel of this.dataChannels) {
      if (channel.label === "reliable") {
        if (channel.bufferedAmount > channel.bufferedAmountLowThreshold) {
          channel._sendQueue.push(data.slice());
        } else {
          channel.send(data);
        }
        return;
      }
    }
    console.warn("No reliabale DataChannel found");
  }

  sendUnreliable(data) {
    for (let channel of this.dataChannels) {
      if (channel.label === "unreliable") {
        if (channel.bufferedAmount > channel.bufferedAmountLowThreshold) {
          console.warn("Dropping unreliable packet due to back preasure");
        } else {
          channel.send(data);
        }
        return;
      }
    }
    console.warn("No unreliable DataChannel found");
  }

  _setUpPeer() {
    this.peer.onicecandidate = (e) => {
      if (e.candidate)
        this.ws.sendPacket({ candidate: e.candidate }, this.targetPeerId);
    };

    this.peer.addEventListener("connectionstatechange", (e) => {
      switch (this.peer.connectionState) {
        case "disconnected":
          console.error(e);
          this.close();
          break;
      }
    });

    if (this.mode === MODES.SERVER) {
      this.setUpDataChannel(
        this.peer.createDataChannel("reliable", {
          ordered: true,
        }),
      );
      this.setUpDataChannel(
        this.peer.createDataChannel("unreliable", {
          ordered: false,
          maxRetransmits: 0,
        }),
      );

      this.worker.postMessage(
        {
          type: "set_channels",
          id: this.targetPeerId,
          channels: this.dataChannels,
        },
        this.dataChannels,
      );

      this.onClose(() => {
        this.worker.postMessage({
          type: "close_channels",
          id: this.targetPeerId,
        });
        serverPeers.delete(this.targetPeerId);
      });
    } else if (this.mode === MODES.CLIENT) {
      this.peer.addEventListener("datachannel", (e) => {
        const channel = e.channel;

        this.setUpDataChannel(channel);

        channel.addEventListener("open", () => {
          this.ws.close();
        });

        channel.addEventListener("close", () => {
          console.log("Closing peer due to datachannel closure");
          this.peer.close();
        });

        this.onClose(() => {
          channel.close();
          // DataChannels can get stuck half closed on sudden disconnects
          // since we disconnect from signaling
          channel.dispatchEvent(new Event("close"));
        });
      });
    }
  }

  _makeWsConnection() {
    console.log("Connecting to singaling server");

    const ws = new WebSocket(
      `${window.location.protocol === "https:" ? "wss" : "ws"}://${CONFIG.CerealConnector.signalingUrl}/${this.mode === MODES.SERVER ? "host" : `?id=${this.targetPeerId}`}`,
    );

    ws.sendPacket = (dat, targetId) => {
      if (ws.readyState !== WebSocket.OPEN) {
        ws.addEventListener("open", () => {
          ws.sendPacket(dat, targetId);
        });
        return;
      }
      ws.send(JSON.stringify({ ...dat, target: targetId }));
    };

    if (this.mode === MODES.SERVER) {
      ws.addEventListener("message", async (e) => {
        const dat = JSON.parse(e.data);
        const sender = dat.from;

        if (dat.type === "SIGNAL_SOCKET_ID") {
          this.ws.socketId = dat.socketId;
          for (let func of this._wsOpenCustoms) {
            func();
          }
        } else if (dat.type === "JOIN") {
          console.log("New join request from", sender);
        }

        if (!sender) return;
        let cerealPeer = serverPeers.get(sender);
        if (cerealPeer === undefined) {
          console.log(
            "Attempting to create a connection from server peer to client peer",
          );
          cerealPeer = new CerealPeer(this.mode, sender, this.worker);
          cerealPeer.makeServerPeer(this.iceServers);
          serverPeers.set(sender, cerealPeer);
        }

        if (dat.answer) {
          await cerealPeer.peer.setRemoteDescription(dat.answer);
        } else if (dat.candidate) {
          await cerealPeer.peer.addIceCandidate(dat.candidate);
        }
      });

      if (this.worker.setUp !== true) {
        this.worker.setUp = true;
        this.worker.addEventListener("message", (e) => {
          const { type, id } = e.data;
          let cerealPeer;
          switch (type) {
            case "peer_open":
              cerealPeer = serverPeers.get(id);
              for (let dc of cerealPeer.dataChannels) {
                dc.dispatchEvent(new Event("open"));
              }
              break;
            case "close_peer":
              cerealPeer = serverPeers.get(id);
              if (cerealPeer) cerealPeer.close();
              serverPeers.delete(id);
              break;
          }
        });
      }

      ws.addEventListener("close", (e) => {
        console.log(
          "Reconnecting server signaling server connection in",
          serverReconTime,
          "ms",
        );

        setTimeout(() => {
          let oldWs = serverSignalingWs;
          serverSignalingWs = this._makeWsConnection();
          oldWs.dispatchEvent(new Event("newCon"));
        }, serverReconTime);
      });
    } else if (this.mode === MODES.CLIENT) {
      ws.addEventListener("message", async (e) => {
        const dat = JSON.parse(e.data);
        if (dat.offer) {
          await this.peer.setRemoteDescription(dat.offer);
          const ans = await this.peer.createAnswer();
          await this.peer.setLocalDescription(ans);
          this.ws.sendPacket(
            { answer: this.peer.localDescription },
            this.targetPeerId,
          );
        } else if (dat.candidate) {
          await this.peer.addIceCandidate(dat.candidate);
        }
      });

      ws.addEventListener("close", () => {
        console.log("Client connection to signaling server closed");
      });
    }

    ws.addEventListener("open", (e) => {
      console.log("Connected to signaling server");

      if (this.mode === MODES.SERVER) {
        ws.sendPacket({
          type: "SIGNAL_HOST_ICE_SERVERS",
          servers: this.iceServers,
        });
      } else if (this.mode === MODES.CLIENT) {
        ws.sendPacket({ type: "JOIN" }, this.targetPeerId);
      }
    });

    return ws;
  }

  makeServerPeer(ICE_SERVERS) {
    this.iceServers = ICE_SERVERS;
    this.peer = new RTCPeerConnection({
      iceServers: this.iceServers,
    });

    this.peer.onnegotiationneeded = async () => {
      const offer = await this.peer.createOffer();
      await this.peer.setLocalDescription(offer);
      this.ws.sendPacket(
        { offer: this.peer.localDescription },
        this.targetPeerId,
      );
    };

    this._setUpPeer();
  }

  makeClientPeer(ICE_SERVERS) {
    this.peer = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
    });

    this._setUpPeer();
  }

  close() {
    if (this.hasClosed === true) return;
    this.hasClosed = true;
    console.log(
      `CerealPeer ${this.id} (${this.mode === MODES.SERVER ? "SERVER" : this.mode === MODES.CLIENT ? "CLIENT" : "BLANK/UNKNOWN"}) Closing`,
    );
    for (let func of this._customCloses) {
      func();
    }
  }

  onClose(func) {
    if (this.hasClosed === true) {
      func();
      return;
    }
    this._customCloses.push(func);
  }

  onMessage(func) {
    if (this.hasClosed === true) return;
    this._customMessages.push(func);
  }

  onOpen(func) {
    if (this.hasOpened === true) {
      func();
      return;
    }
    this._customOpens.push(func);
  }

  onWsOpen(func) {
    if (this.ws.socketId) {
      func();
      return;
    }
    this._wsOpenCustoms.push(func);
  }
}

class CerealConnector {
  constructor(mode) {
    this.mode = mode;
    this.connections = new Set();
    this.onPacketFuncs = new Map();

    this.headerArr = new ArrayBuffer(CONNECTOR_OFFSETS._totalBytes);
    this.headerU8 = new Uint8Array(this.headerArr);
    this.headerDv = new DataView(this.headerArr);

    this.sendBuf = new ArrayBuffer(SEND_BUF_SIZE);
    this.sendU8 = new Uint8Array(this.sendBuf);
    this.sendDv = new DataView(this.sendBuf);

    this.scratchBuf = new ArrayBuffer(SEND_BUF_SIZE);
    this.scratchU8 = new Uint8Array(this.scratchBuf);
    this.scratchDv = new DataView(this.scratchBuf);

    this.BLANK_DATA = new ArrayBuffer();

    this._setUpDefaultHandlers();
  }

  sendPacket(type, data, cnt, connectedCheck) {
    if (cnt) {
      if (
        cnt.status === STATUS.OPEN ||
        (connectedCheck && cnt.status === STATUS.CONNECTED)
      ) {
        cnt.sendUnreliable(this._processSendData(type, data, cnt));
      } else {
        console.warn(
          `Dropped packet type ${type} for some connection of status ${cnt.status}`,
        );
      }
    } else {
      for (let cnt of this.connections) {
        if (
          cnt.status === STATUS.OPEN ||
          (connectedCheck && cnt.status === STATUS.CONNECTED)
        ) {
          cnt.sendReliable(this._processSendData(type, data, cnt));
        } else {
          console.warn(
            `Dropped packet type ${type} for some connection of status ${cnt.status}`,
          );
        }
      }
    }
  }

  onPacket(type, func) {
    if (typeof type !== "number" || PACKET_TYPES[type] === undefined) {
      throw new Error(
        `Packet type "${type}" is not a valid packet type and cannot be listened for.`,
      );
    }
    if (CACHE_MODES[type] === this.mode) {
      throw new Error(
        `Packet type "${type}" is mode "${this.mode}" authoritive. You cannot listen for it in mode "${this.mode}" as well.`,
      );
    }
    if (this.onPacketFuncs.has(type)) {
      this.onPacketFuncs.get(type).push(func);
    } else {
      this.onPacketFuncs.set(type, [func]);
    }
  }

  removeConnection(cnt, reason = "removeConnection called") {
    if (cnt.status === STATUS.DISCONNECTED) return;
    const buf = this.scratchBuf.slice(0, addString(reason, this.scratchBuf, 0));
    const dv = new DataView(buf);
    let funcArr = this.onPacketFuncs.get(PACKET_TYPES.DISCONNECT);
    for (let func of funcArr) {
      func(cnt, buf, dv);
    }
    console.log("Connection removed");
  }

  addConnection(input) {
    if (input instanceof CerealPeer) {
      return this._addCerealPeer(input);
    }
    throw new Error(
      `Connection type "${typeof input}" is not supported! ${input}`,
    );
  }

  _addCerealPeer(cerealPeer) {
    const cc = new CerealConnection(cerealPeer);
    cc.setSendReliable(cerealPeer.sendReliable.bind(cerealPeer));
    cc.setSendUnreliable(cerealPeer.sendUnreliable.bind(cerealPeer));
    cc.setClose(cerealPeer.close.bind(cerealPeer));
    cerealPeer.onMessage(this._processReceiveData.bind(this, cc));

    cerealPeer.onOpen(() => {
      this.scratchDv.setUint16(
        PACKET_TYPES.SOCKET_CONNECT,
        CONNECTOR_OFFSETS.packetType,
        true,
      );
      let dv = new DataView(
        this.scratchBuf.slice(0, CONNECTOR_OFFSETS._totalBytes),
        0,
        CONNECTOR_OFFSETS._totalBytes,
      );

      let funcArr = this.onPacketFuncs.get(PACKET_TYPES.SOCKET_CONNECT);
      for (let func of funcArr) {
        func(cc, dv.buffer, dv);
      }

      for (let func of cc._openQueue) {
        func();
      }
      cc._openQueue.length = 0;
    });

    cerealPeer.onClose(() => {
      console.log("CerealPeer closed");
      this.removeConnection(cc, "CerealPeer Closed");
    });

    this.connections.add(cc);
    return cc;
  }

  _setUpDefaultHandlers() {
    this.onPacket(PACKET_TYPES.SOCKET_CONNECT, (cnt, data, dv) => {
      cnt.status = STATUS.CONNECTED;
    });

    this.onPacket(PACKET_TYPES.DISCONNECT, (cnt, data, dv) => {
      cnt.status = STATUS.DISCONNECTED;
      this.connections.delete(cnt);
      console.log(
        this.mode,
        "Connection closed. Reason:",
        parseString(data, 0),
      );
    });

    this.onPacket(PACKET_TYPES.CONNECT, (cnt, data, dv) => {
      if (this.mode === MODES.CLIENT) return; // Client should never receive a connect req
      const version = dv.getUint16(0, true);
      if (version !== CONNECTOR_VER) {
        console.warn("Connection has mismatched connecter versions");
        const slice = this.scratchU8.slice(
          0,
          addString(
            `Connection version mismatch! You: V${version} Target: V${CONNECTOR_VER}`,
            this.scratchBuf,
            0,
          ),
        );
        this.sendPacket(PACKET_TYPES.DISCONNECT, slice, cnt, true);
        return;
      }

      // Do pre-game stuff with other packets

      // Once preloading is done, OPEN must be called
      this.sendPacket(PACKET_TYPES.OPEN, this.BLANK_DATA, cnt, true);
    });

    this.onPacket(PACKET_TYPES.OPEN, (cnt, data, dv) => {
      cnt.status = STATUS.OPEN;
    });

    this.onPacket(PACKET_TYPES.CACHE_UPDATE, (cnt, data, dv) => {
      const [type, newPacket] = cnt.processReceiveCache(data, dv);
      const newDv = new DataView(
        newPacket.buffer,
        newPacket.byteOffset,
        newPacket.byteLength,
      );

      let funcArr = this.onPacketFuncs.get(type);
      if (funcArr === undefined || funcArr.length === 0) {
        console.warn(
          `(${this.mode}) There are no receivers for packet type "${type}"`,
        );
        return;
      } else {
        for (let func of funcArr) {
          func(cnt, newPacket, newDv);
        }
      }
    });
  }

  _processSendData(type, data, cnt) {
    data = new Uint8Array(data);

    const diffPacket =
      CACHE_MODES[type] === this.mode
        ? cnt.processSendCache(type, data)
        : false;

    if (diffPacket === false) {
      // Actual packet
      this.headerDv.setUint16(CONNECTOR_OFFSETS.packetType, type, true);
      this.scratchU8.set(this.headerU8, 0);
      this.scratchU8.set(data, this.headerU8.byteLength);
      return this.scratchU8.subarray(
        0,
        this.headerArr.byteLength + data.byteLength,
      );
    } else {
      // Update cache packet
      this.headerDv.setUint16(
        CONNECTOR_OFFSETS.packetType,
        PACKET_TYPES.CACHE_UPDATE,
        true,
      );
      this.scratchU8.set(this.headerU8, 0);
      this.scratchU8.set(diffPacket, this.headerU8.byteLength);
      return this.scratchU8.subarray(
        0,
        this.headerArr.byteLength + diffPacket.byteLength,
      );
    }
  }

  _processReceiveData(cnt, e) {
    // WebRTC DataChannels can receive messages before they are open
    if (cnt.status !== STATUS.OPEN && cnt.status !== STATUS.CONNECTED) {
      cnt.onOpen(() => {
        this._processReceiveData(cnt, e);
      });
      return;
    }
    const data = new Uint8Array(e.data);
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const type = dv.getUint16(CONNECTOR_OFFSETS.packetType, true);
    const finalArr = data.subarray(CONNECTOR_OFFSETS._totalBytes);
    const finalDv = new DataView(
      finalArr.buffer,
      finalArr.byteOffset,
      finalArr.byteLength,
    );

    if (CACHE_MODES[type] !== undefined && CACHE_MODES[type] !== this.mode) {
      if (cnt.packetCache[type] === undefined) {
        cnt.packetCache[type] = new Uint8Array(
          new ArrayBuffer(SEND_BUF_SIZE),
          0,
          0,
        );
      }
      cnt.packetCache[type] = new Uint8Array(
        cnt.packetCache[type].buffer,
        0,
        finalArr.byteLength,
      );
      cnt.packetCache[type].set(finalArr, 0);
    }

    let funcArr = this.onPacketFuncs.get(type);
    if (funcArr === undefined || funcArr.length === 0) {
      console.warn(
        `(${this.mode}) There are no receivers for packet type "${type}"`,
      );
      return;
    } else {
      for (let func of funcArr) {
        func(cnt, finalArr, finalDv);
      }
    }
  }
}

// Send buf size is 0xffff
// Ideally string length is managed per packet; you expect certain lengths
const MAX_STRING_LENGTH = 0xfff;
const STRING_LENGTH_PADDING = 2;
function addString(str, buf, index) {
  buf = new Uint8Array(buf);
  const start = index + STRING_LENGTH_PADDING;
  for (let i = start; i < start + MAX_STRING_LENGTH; i++) {
    const char = str.charCodeAt(i - start);
    if (char) {
      buf[i] = char;
    } else {
      const length = i - (index + STRING_LENGTH_PADDING);
      buf[index] = length & 0xff;
      buf[index + 1] = (length >> 8) & 0xff;
      return i;
    }
  }
}

function parseString(buf, index) {
  buf = new Uint8Array(buf);
  const length = (buf[index + 1] << 8) | buf[index];
  let str = "";
  const start = index + STRING_LENGTH_PADDING;
  for (let i = start; i < start + length; i++) {
    str += String.fromCharCode(buf[i]);
  }
  return str;
}

export {
  CerealConnector,
  CerealPeer,
  PACKET_TYPES,
  CONNECTOR_VER,
  MODES,
  SEND_BUF_SIZE,
  STATUS,
};
