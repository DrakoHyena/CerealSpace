const CONNECTOR_VER = 0;
const SEND_BUF_SIZE = 0xffff;

const PACKET_TYPES = {
  DISCONNECT: 0,
  CONNECT: 1,
  OPEN: 2,
  CACHE_UPDATE: 3,
  SPACE_INFO: 4,
  ENTITIES: 5,
};

const MODES = {
  SERVER: 0,
  CLIENT: 1,
};

const CACHE_MODES = {
  SPACE_INFO: MODES.SERVER,
};

const CONNECTOR_OFFSETS = {
  packetType: 0, // 2
  _totalBytes: 2,
};

for (let key in CACHE_MODES) {
  CACHE_MODES[PACKET_TYPES[key]] = CACHE_MODES[key];
}

class CerealConnection {
  constructor(cnt) {
    this.cnt = cnt;
    this.enablePacketCaching = true;
    this.packetCache = {};
    this.diff = new Uint8Array(SEND_BUF_SIZE);
    this.diffView = new DataView(this.diff.buffer);
    this.canSend = () => {
      return true;
    };
    this.send = () => {};
    this.close = () => {};
  }
  setCanSend(func) {
    this.canSend = func;
  }
  setSend(func) {
    this.send = func;
  }
  setClose(func) {
    this.close = func;
  }
  diffPacketAndCache(type, newPacket) {
    if (newPacket instanceof Uint8Array === false) {
      throw new Error("Expected Uint8Array");
    }
    if (this.packetCache[type] === undefined) {
      this.packetCache[type] = new Uint8Array(SEND_BUF_SIZE);
      this.packetCache[type].set(newPacket, 0);
      this.packetCache[type]._packetLength = newPacket.byteLength;
      return false;
    }

    const cachePacket = this.packetCache[type];
    const cacheLength = this.packetCache[type]._packetLength;
    let dvIndex = 2;
    const dv = this.diffView;
    dv.setUint16(0, type, true);
    const MAX_GAP = 4;
    let gap = 0;
    let startIndex = -1;
    for (let i = 0; i < cacheLength; i++) {
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
      const endIndex = cacheLength - gap;
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

    cachePacket.set(newPacket, 0);
    cachePacket._packetLength = newPacket.byteLength;
    return this.diff.subarray(0, dvIndex);
  }
  applyDiffAndCache(diffPacket, dv) {
    let i = 0;
    const type = dv.getUint16(i, true);
    i += 2;
    const cachePacket = this.packetCache[type];
    if (cachePacket === undefined) {
      throw new Error(
        `No packet cache created for type "${type}" on connection "${this}"`,
      );
    }

    while (i < diffPacket.byteLength) {
      const index = dv.getUint16(i, true);
      i += 2;
      const len = dv.getUint16(i, true);
      i += 2;
      cachePacket.set(diffPacket.subarray(i, i + len), index);
      i += len;
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

    this.BLANK_DATA = new ArrayBuffer();

    this._setUpDefaultHandlers();
  }

  addConnection(input) {
    if (
      input instanceof Worker ||
      input instanceof DedicatedWorkerGlobalScope
    ) {
      this._addWorker(input);
      return;
    }
    throw new Error(
      `Connection type "${typeof input}" is not supported! ${input}`,
    );
  }

  _setUpDefaultHandlers() {
    this.onPacket(PACKET_TYPES.DISCONNECT, (cnt, data, dv) => {
      this.removeConnection(cnt);
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
        const slice = this.sendU8.slice(
          0,
          addString(
            this.sendBuf,
            `Connection version mismatch! You: V${version} Target: V${CONNECTOR_VER}`,
            0,
          ),
        );
        this.sendPacket(PACKET_TYPES.DISCONNECT, slice, cnt);
        return;
      }

      // Do pre-game stuff like assets here...

      // Not required, the server is expected to be open after a verified connection... but polite
      this.sendPacket(PACKET_TYPES.OPEN, this.BLANK_DATA, cnt);
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

  sendPacket(type, data, cnt) {
    if (cnt) {
      if (cnt.canSend()) {
        cnt.send(this._processSendData(type, data, cnt));
      }
    } else {
      for (let cnt of this.connections) {
        if (cnt.canSend()) {
          cnt.send(this._processSendData(type, data, cnt));
        }
      }
    }
  }

  onPacket(type, func) {
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

  _processSendData(type, data, cnt) {
    const diffPacket =
      CACHE_MODES[type] === this.mode
        ? cnt.diffPacketAndCache(type, data)
        : false;
    if (diffPacket === false) {
      // Actual packet
      this.headerDv.setUint16(CONNECTOR_OFFSETS.packetType, type, true);
      this.sendU8.set(this.headerU8, 0);
      this.sendU8.set(data, this.headerU8.byteLength);
      return this.sendU8.subarray(
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
      this.sendU8.set(this.headerU8, 0);
      this.sendU8.set(diffPacket, this.headerU8.byteLength);
      return this.sendU8.subarray(
        0,
        this.headerArr.byteLength + diffPacket.byteLength,
      );
    }
  }

  _processReceiveData(cnt, e) {
    const data = e.data;
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
        cnt.packetCache[type] = new Uint8Array(SEND_BUF_SIZE);
      }
      cnt.packetCache[type].set(finalArr, 0);
      cnt.packetCache[type]._packetLength = finalArr.byteLength;
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

  removeConnection(cnt) {
    cnt.close();
    this.connections.delete(cnt);
  }

  _addWorker(worker) {
    const cc = new CerealConnection(worker);
    cc.setCanSend(() => {
      return true;
    });
    cc.setSend(worker.postMessage.bind(worker));
    cc.setClose(worker.terminate);
    worker.onmessage = this._processReceiveData.bind(this, cc);
    this.connections.add(cc);
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

export { CerealConnector, PACKET_TYPES, CONNECTOR_VER, MODES };
