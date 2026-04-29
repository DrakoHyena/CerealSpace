const CONNECTOR_VER = 0;
const SEND_BUF_SIZE = 2 ** 16;

const PACKET_TYPES = {
  DISCONNECT: 0,
  CONNECT: 1,
  OPEN: 2,
  SPACE_INFO: 3,
  ENTITIES: 4,
};

const CONNECTOR_OFFSETS = {
  packetType: 0, // 2
  _totalBytes: 2,
};

const MODES = {
  SERVER: 0,
  CLIENT: 1,
};

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

    this.BLANK_DATA = new ArrayBuffer(0);

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
  }

  sendPacket(type, data, targetCon) {
    const processedData = this._processSendData(type, data);
    if (targetCon) {
      if (targetCon._canSend()) targetCon._send(processedData);
    } else {
      for (let cnt of this.connections) {
        if (cnt._canSend()) cnt._send(processedData);
      }
    }
  }

  onPacket(type, func) {
    if (this.onPacketFuncs.has(type)) {
      this.onPacketFuncs.get(type).push(func);
    } else {
      this.onPacketFuncs.set(type, [func]);
    }
  }

  _processSendData(type, data) {
    this.headerDv.setUint16(CONNECTOR_OFFSETS.packetType, type, true);

    this.sendU8.set(this.headerU8, 0);
    this.sendU8.set(data, this.headerU8.byteLength);
    return this.sendU8.subarray(0, this.headerArr.byteLength + data.byteLength);
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
    cnt._close();
    this.connections.delete(cnt);
  }

  _addWorker(worker) {
    worker._canSend = () => {
      return true;
    };
    worker._send = worker.postMessage;
    worker.onmessage = this._processReceiveData.bind(this, worker);
    worker._close = worker.close;
    this.connections.add(worker);
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
