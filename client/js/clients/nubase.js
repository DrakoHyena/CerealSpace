import {
  CerealConnector,
  PACKET_TYPES,
  CONNECTOR_VER,
  MODES,
} from "/js/connectors/base.js";
import { SPACE_INFO_OFFSETS } from "/js/spaces/base.js";
import { BYTES_PER_ENTITY } from "/js/entities/base.js";

class CerealClient {
  constructor(canvas, serverWorker) {
    this.canvas = canvas;
    this.ctx = this.canvas.getContext("2d");

    this.entityBuf = new ArrayBuffer(0);
    this.spaceInfo = {
      width: 1,
      height: 1,
      entityAmount: 0,
      tickTime: 0,
    };
    this.camera = {
      x: 0,
      y: 0,
      fov: 500,
    };
    this.avgRender = 0;

    this.serverWorker = serverWorker;
    this.connector = new CerealConnector(MODES.CLIENT);
    this.connection = this.connector.addConnection(this.serverWorker);
    this._setUpPackets();
    this.connector.sendDv.setUint16(0, CONNECTOR_VER, true);
    this.connector.sendPacket(
      PACKET_TYPES.CONNECT,
      this.connector.sendU8.subarray(0, 2),
      this.connection,
    );

    this.render(this.render);
  }

  render() {
    requestAnimationFrame(this.render.bind(this));
    let { canvas, ctx, camera, spaceInfo, avgRender, entityBuf } = this;
    const s = performance.now();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(camera.x, camera.y);

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, spaceInfo.width, spaceInfo.height);

    ctx.fillStyle = "grey";
    const dv = new DataView(entityBuf);
    for (let i = 0; i < entityBuf.byteLength; i += BYTES_PER_ENTITY) {
      if (dv.getUint8(i) === 0) break;
      const x = dv.getUint16(i + CEREAL_ENTITY_OFFSETS.px, true);
      const y = dv.getUint16(i + CEREAL_ENTITY_OFFSETS.py, true);
      const w = dv.getUint16(i + CEREAL_ENTITY_OFFSETS.w, true);
      const h = dv.getUint16(i + CEREAL_ENTITY_OFFSETS.h, true);
      ctx.fillRect(x, y, w, h);
    }

    ctx.restore();
    avgRender *= 0.95;
    avgRender += 0.05 * (performance.now() - s);
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
      this.spaceInfo.width = dv.getUint16(SPACE_INFO_OFFSETS.width, true);
      this.spaceInfo.height = dv.getUint16(SPACE_INFO_OFFSETS.height, true);
      this.spaceInfo.entityAmount = dv.getUint32(
        SPACE_INFO_OFFSETS.entityAmount,
        true,
      );
      this.spaceInfo.tickTime =
        dv.getUint32(SPACE_INFO_OFFSETS.tickTime, true) * 0.01;
    });

    this.connector.onPacket(PACKET_TYPES.ENTITY, (cnt, data, dv) => {
      this.entityBuf = data;
      console.log(this.entityBuf);
    });
  }
}

export { CerealClient };
