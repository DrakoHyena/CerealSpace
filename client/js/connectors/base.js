const CONNECTOR_VER = 0;

const PACKET_TYPES = {
  _CEREAL_CONNECT: 0,
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

  sendPacket(type, data) {
    const processedData = this._processSendData(type, data);
    for (let cnt of this.connections) {
      if (cnt._canSend()) cnt._send(processedData);
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

  _processReceiveData(data) {
    const dv = new DataView(data);
    const type = dv.getUint16(CONNECTOR_OFFSETS.packetType, true);
    const finalArr = data.subarray(CONNECTOR_OFFSETS._totalBytes);

    let funcArr = this.onPacketFuncs.get(type);
    if (funcArr === undefined || funcArr.length === 0) {
      console.warn(
        `(${this.mode}) There are receivers for packet type "${type}"`,
      );
      return;
    } else {
      for (let func of funcArr) {
        func(finalArr);
      }
    }
  }

  _addWorker(worker) {
    worker._canSend = () => {
      return true;
    };
    worker._send = worker.postMessage;
    worker.onmessage = this._processReceiveData;
    this.connections.add(worker);
  }
}

export { CerealConnector, PACKET_TYPES };
