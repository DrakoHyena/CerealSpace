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

const MODES = {
  SERVER: 0,
  CLIENT: 1,
};

const CACHE_MODES = {
  SPACE_INFO: MODES.SERVER,
  VIEW: MODES.SERVER,
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

    this.status = STATUS.CONNECTING;

    this.diff = new Uint8Array(SEND_BUF_SIZE);
    this.diffView = new DataView(this.diff.buffer);

    this.send = () => {};
    this.close = () => {};
  }
  setSend(func) {
    this.send = func;
  }
  setClose(func) {
    this.close = func;
  }
  diffPacketAndCache(type, newPacket) {
    if (this.packetCache[type] === undefined) {
      const cacheBuf = new ArrayBuffer(SEND_BUF_SIZE);
      this.packetCache[type] = new Uint8Array(
        cacheBuf,
        0,
        newPacket.byteLength,
      );
      this.packetCache[type].set(newPacket, 0);
      return false;
    }

    const cachePacket = this.packetCache[type];
    const loopLen = newPacket.byteLength;
    let dvIndex = 4;
    const dv = this.diffView;
    dv.setUint16(0, type, true);
    dv.setUint16(2, newPacket.byteLength, true);
    const MAX_GAP = 4;
    let gap = 0;
    let startIndex = -1;
    for (let i = 0; i < loopLen; i++) {
      if (cachePacket[i] !== newPacket[i]) {
        if (startIndex === -1) {
          startIndex = i;
        }
        gap = 0;
      } else {
        if (startIndex !== -1) {
          gap++;
          if (gap === MAX_GAP) {
            const endIndex = i - gap + 1;
            const chunkLen = endIndex - startIndex;

            dv.setUint16(dvIndex, startIndex, true);
            dvIndex += 2;
            dv.setUint16(dvIndex, chunkLen, true);
            dvIndex += 2;
            this.diff.set(newPacket.subarray(startIndex, endIndex), dvIndex);
            dvIndex += chunkLen;

            startIndex = -1;
            gap = 0;
          }
        }
      }
    }
    if (startIndex !== -1) {
      const endIndex = loopLen - gap;
      const chunkLen = endIndex - startIndex;

      if (chunkLen > 0) {
        dv.setUint16(dvIndex, startIndex, true);
        dvIndex += 2;
        dv.setUint16(dvIndex, chunkLen, true);
        dvIndex += 2;
        this.diff.set(newPacket.subarray(startIndex, endIndex), dvIndex);
        dvIndex += chunkLen;
      }
    }
    this.packetCache[type] = new Uint8Array(
      cachePacket.buffer,
      0,
      newPacket.byteLength,
    );
    this.packetCache[type].set(newPacket, 0);
    return this.diff.subarray(0, dvIndex);
  }
  applyDiffAndCache(diffPacket, dv) {
    let i = 0;
    const type = dv.getUint16(i, true);
    i += 2;
    const len = dv.getUint16(i, true);
    i += 2;
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
      const index = dv.getUint16(i, true);
      i += 2;
      const eLen = dv.getUint16(i, true);
      i += 2;
      cachePacket.set(diffPacket.subarray(i, i + eLen), index);
      i += eLen;
    }
    return [type, cachePacket];
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
        cnt.send(this._processSendData(type, data, cnt));
      }
    } else {
      for (let cnt of this.connections) {
        if (
          cnt.status === STATUS.OPEN ||
          (connectedCheck && cnt.status === STATUS.CONNECTED)
        ) {
          cnt.send(this._processSendData(type, data, cnt));
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

  removeConnection(cnt) {
    cnt.STATUS = STATUS.DISCONNECTED;
    const buf = this.scratchU8.slice(
      0,
      addString(this.scratchBuf, "removeConnection called", 0),
    );
    const dv = new DataView(buf);
    let funcArr = this.onPacketFuncs.get(PACKET_TYPES.DISCONNECT);
    for (let func of funcArr) {
      func(cnt, buf, dv);
    }
    this.connections.delete(cnt);
  }

  addConnection(input) {
    if (
      input instanceof Worker ||
      (self.DedicatedWorkerGlobalScope &&
        input instanceof self.DedicatedWorkerGlobalScope)
    ) {
      return this._addWorker(input);
    } else if (input instanceof RTCDataChannel) {
      return this._addRTCDataChannel(input);
    }
    throw new Error(
      `Connection type "${typeof input}" is not supported! ${input}`,
    );
  }

  makeServerPeer(worker) {
    if (worker instanceof Worker === false) {
      throw new Error("The first parameter of makeServerPeer must be a Worker");
    }
    console.log("Making server peer connection");
    console.log("Connecting to singaling server");
    const ws = new WebSocket(
      `ws://${CONFIG.CerealConnector.signalingUrl}/host`,
    );
    ws.sendPacket = (dat, targetId) => {
      ws.send(JSON.stringify({ ...dat, target: targetId }));
    };

    ws.onerror = (e) => {
      console.log("Failed to connect to singaling signaling server");
      console.error(e);
    };

    ws.onclose = (e) => {
      console.log("Server connection to the singaling server closed");
      console.log(e);
    };

    ws.onopen = (e) => {
      console.log("Connected to signaling server");
    };

    const channelIdToPeer = new Map();
    worker.onmessage = (e) => {
      const { type, channelId } = e.data;
      switch (type) {
        case "channel_close":
          channelIdToPeer.get(channelId).close();
          channelIdToPeer.delete(channelId);
          break;
      }
    };

    const connectedPeers = new Map();
    ws.onmessage = async (e) => {
      const dat = JSON.parse(e.data);
      const sender = dat.from;

      if (dat.type === "SIGNAL_SOCKET_ID") {
        ws.socketId = dat.socketId;
      } else if (dat.type === "JOIN") {
        console.log("New join request from sender", sender);
      }

      if (!sender) return;
      let peer = connectedPeers.get(sender);
      if (peer === undefined) {
        console.log("Attemping to create peer connection", sender);

        peer = new RTCPeerConnection({
          iceServers: CONFIG.CerealConnector.iceServers,
        });

        const dc = peer.createDataChannel("data");
        const id = crypto.randomUUID();
        channelIdToPeer.set(id, peer);
        worker.postMessage({ type: "channel_make", channel: dc, id: id }, [dc]);

        peer.onicecandidate = (e) => {
          if (e.candidate) ws.sendPacket({ candidate: e.candidate });
        };

        peer.onnegotiationneeded = async () => {
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          ws.sendPacket({ offer: peer.localDescription }, sender);
        };

        peer.onconnectionstatechange = (e) => {
          switch (peer.connectionState) {
            case "disconnected":
            case "failed":
              console.log("Peer disconnected or failed to connect");
              console.error(e);
              worker.postMessage({ type: "channel_destroy", id: id });
              connectedPeers.delete(sender);
              break;
          }
        };

        connectedPeers.set(sender, peer);
      }

      if (dat.answer) {
        await peer.setRemoteDescription(dat.answer);
      } else if (dat.candidate) {
        await peer.addIceCandidate(dat.candidate);
      }
    };
  }

  async makeClientPeer(targetId) {
    console.log("Making client peer connection");
    console.log("Connecting to signaling server");

    const ws = new WebSocket(
      `ws://${CONFIG.CerealConnector.signalingUrl}/join?id=${targetId}`,
    );

    ws.sendPacket = (dat) => {
      console.log(dat);
      ws.send(JSON.stringify({ ...dat, target: targetId }));
    };

    ws.onerror = (e) => {
      console.log("Failed to connect to singaling server");
      console.error(e);
    };

    ws.onclose = (e) => {
      console.log("Connection to the singaling server closed");
      console.log(e);
    };

    ws.onopen = (e) => {
      console.log("Connected to signaling server");
      ws.sendPacket({ type: "JOIN" }); // notify them we're connecting
    };

    console.log("Attempting to create peer connection");
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    peer.onicecandidate = (e) => {
      if (e.candidate) ws.sendPacket({ candidate: e.candidate });
    };

    peer.onconnectionstatechange = (e) => {
      switch (peer.connectionState) {
        case "disconnected":
        case "failed":
          console.log("Peer disconnected or failed to connect");
          console.error(e);
          break;
      }
    };

    let prom = new Promise((res, rej) => {
      peer.ondatachannel = (e) => {
        e.channel.addEventListener("open", () => {
          console.log("Connected to server peer from client");
          ws.close();
        });
        res(e.channel);
      };
    });

    ws.onmessage = async (e) => {
      const dat = JSON.parse(e.data);
      if (dat.type === "SIGNAL_SOCKET_ID") {
        ws.socketId = dat.socketId;
      } else if (dat.type === "JOIN") {
        throw new Error("Client peer connection received join request");
      } else {
        if (dat.offer) {
          await peer.setRemoteDescription(dat.offer);
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          ws.sendPacket({ answer: peer.localDescription });
        } else if (dat.candidate) {
          await peer.addIceCandidate(dat.candidate);
        }
      }
    };

    return prom;
  }

  _addRTCDataChannel(dc) {
    const cc = new CerealConnection(dc);
    cc.setSend(dc.send.bind(dc));
    cc.setClose(dc.close.bind(dc));
    dc.onmessage = this._processReceiveData.bind(this, cc);
    this.connections.add(cc);

    dc.onclose = () => {
      peer.close();
      this.removeConnection(cc);
      console.log("DataChannel closed");
    };
    dc.onerror = (e) => {
      peer.close();
      this.removeConnection(cc);
      console.log("DataChannel error");
      throw new Error(e);
    };
    dc.onopen = () => {
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
    };
    return cc;
  }

  _addWorker(worker) {
    const cc = new CerealConnection(worker);
    cc.setSend((data) => worker.postMessage(data.slice()));
    cc.setClose(
      this.mode === MODES.CLIENT ? worker.terminate.bind(worker) : () => {},
    );
    worker.onmessage = this._processReceiveData.bind(this, cc);
    this.connections.add(cc);
    setTimeout(() => {
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
    });
    return cc;
  }

  _setUpDefaultHandlers() {
    this.onPacket(PACKET_TYPES.SOCKET_CONNECT, (cnt, data, dv) => {
      cnt.status = STATUS.CONNECTED;
    });

    this.onPacket(PACKET_TYPES.DISCONNECT, (cnt, data, dv) => {
      cnt.status = STATUS.DISCONNECTED;
      cnt.close();
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
            this.scratchBuf,
            `Connection version mismatch! You: V${version} Target: V${CONNECTOR_VER}`,
            0,
          ),
        );
        this.sendPacket(PACKET_TYPES.DISCONNECT, slice, cnt, true);
        return;
      }

      // Do pre-game stuff like assets here...

      this.sendPacket(PACKET_TYPES.OPEN, this.BLANK_DATA, cnt, true);
    });

    this.onPacket(PACKET_TYPES.OPEN, (cnt, data, dv) => {
      cnt.status = STATUS.OPEN;
    });

    this.onPacket(PACKET_TYPES.CACHE_UPDATE, (cnt, data, dv) => {
      const [type, newPacket] = cnt.applyDiffAndCache(data, dv);
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
        ? cnt.diffPacketAndCache(type, data)
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

const MAX_STRING_LENGTH = 0xfff;
const STRING_LENGTH_PADDING = 2;
function addString(str, buf, index) {
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
  PACKET_TYPES,
  CONNECTOR_VER,
  MODES,
  SEND_BUF_SIZE,
  STATUS,
};
