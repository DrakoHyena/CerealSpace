import {
  CerealConnector,
  PACKET_TYPES,
  CONNECTOR_VER,
  MODES,
} from "/js/connectors/base.js";

class CerealClient {
  constructor(canvas, serverWorker) {
    this.canvas = canvas;
    this.ctx = this.canvas.getContext("2d");

    this.serverWorker = serverWorker;
    this.connector = new CerealConnector(MODES.CLIENT);
    this.connection = this.connector.addConnection(this.serverWorker);
    this._setUpPackets();
    this.connector.sendDv.setUint16(0, CONNECTOR_VER, true);
    this.connector.sendPacket(
      PACKET_TYPES.CONNECT,
      this.connector.sendBuf.slice(0, 2),
      this.connection,
    );
  }
  _setUpPackets() {
    this.connector.onPacket(PACKET_TYPES.OPEN, (cnt, data, dv) => {
      // If done with preloads..
      this.connector.sendPacket(
        PACKET_TYPES.OPEN,
        this.connector.BLANK_DATA,
        cnt,
      );
    });

    this.connector.onPacket(PACKET_TYPES.SPACE_INFO, (cnt, data, dv) => {
      console.log("CLIENT", "SPACE INFO", data);
    });
  }
}

export { CerealClient };
