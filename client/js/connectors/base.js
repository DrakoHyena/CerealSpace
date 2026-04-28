const CONNECTOR_VER = 0;
const SEND_BUF_SIZE = 2 ** 16;

const PACKET_TYPES = {
  _CEREAL_DISCONNECT: 0,
  _CEREAL_CONNECT: 1,
};

const CONNECTOR_OFFSETS = {
  packetType: 0, // 2
  _totalBytes: 2,
};

class CerealConnector {
  constructor(mode) {
    this.mode = mode; // "client"/"server"
    this.connections = new Set();
    this.onPacketFuncs = new Map();

    this.headerArr = new Uint8Array(CONNECTOR_OFFSETS._totalBytes);
    this.headerDv = new DataView(this.headerArr);

    this.sendBuf = new Uint8Array(SEND_BUF_SIZE);
    this.sendDv = new DataView(this.sendBuf);
  }

  addConnection(input) {
    if (input instanceof Worker) {
      this._addWorker(input);
      return;
    }
    throw new Error(
      `Connection type "${typeof input}" is not supported! ${input}`,
    );
  }

  _setUp() {
    this.onPacket(PACKET_TYPES._CEREAL_DISCONNECT, (cnt, data, dv) => {
      // TODO: String handling
      console.log("Closed connection");
      return;
    });

    this.onPacket(PACKET_TYPES._CEREAL_CONNECT, (cnt, data, dv) => {
      const version = dv.getUint8(0, true);
      if (version !== CONNECTOR_VER) {
        console.warn("Connection has mismatched conncter versions");
        this.sendPacket(PACKET_TYPES._CEREAL_DISCONNECT, data.slice(0, 0), cnt);
        return;
      }
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
    const newBuf = new Uint8Array(this.headerArr.byteLength + data.byteLength);
    newBuf.set(this.headerArr, 0);
    newBuf.set(data, this.headerArr.byteLength);
    return newBuf;
  }

  _processReceiveData(cnt, data) {
    const dv = new DataView(data);
    const type = dv.getUint16(CONNECTOR_OFFSETS.packetType, true);
    const finalArr = data.subarray(CONNECTOR_OFFSETS._totalBytes);
    const finalDv = new DataView(finalArr);

    let funcArr = this.onPacketFuncs.get(type);
    if (funcArr === undefined || funcArr.length === 0) {
      console.warn(
        `(${this.mode}) There are receivers for packet type "${type}"`,
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
    worker.onmessage = this._processReceiveData.bind(worker);
    worker._close = worker.terminate;
    this.connections.add(worker);
  }
}

export { CerealConnector, PACKET_TYPES };
