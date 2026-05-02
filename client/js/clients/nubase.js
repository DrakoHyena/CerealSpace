import {
  CerealConnector,
  PACKET_TYPES,
  CONNECTOR_VER,
  MODES,
  SEND_BUF_SIZE,
} from "/js/connectors/base.js";
import { SPACE_INFO_OFFSETS } from "/js/spaces/base.js";
import { BYTES_PER_ENTITY } from "/js/entities/base.js";

const CLIENT_CONTROL_OFFSETS = {
  mx: 0, // 2
  my: 2, // 2
  scrollDelta: 4, // 2
  mb0: 6, // 1
  mb1: 7, // 1
  mb2: 8, // 1
  keyLog: 9, // rest
  keyBlock: 3, // size of char info
  _totalBytes: SEND_BUF_SIZE,
};

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

    this.controlBuf = new ArrayBuffer(SEND_BUF_SIZE);
    this.controlU8 = new Uint8Array(this.controlBuf);
    this.controlDv = new DataView(this.controlBuf);
    this.controlIndex = CLIENT_CONTROL_OFFSETS.keyLog;

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
      true,
    );

    this._resize();
    this._setUpEvents();
    this._render();
    this._controlLoop();
  }

  _render() {
    requestAnimationFrame(this._render.bind(this));
    let { canvas, ctx, camera, spaceInfo, avgRender, entityBuf } = this;
    const s = performance.now();

    ctx.fillStyle = "#555555";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
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
      // Preloads go here...

      // ...when  done with preloads
      this.connector.sendPacket(
        PACKET_TYPES.OPEN,
        this.connector.BLANK_DATA,
        cnt,
        true, // <-- Must be included to send while CONNECTED but not OPEN
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

  _setUpEvents() {
    this.canvas.addEventListener("mousedown", (e) => {
      const offset = CLIENT_CONTROL_OFFSETS[`mb${e.button}`];
      if (offset) this.controlDv.setUint8(offset, 1, true);
    });

    this.canvas.addEventListener("mouseup", (e) => {
      const offset = CLIENT_CONTROL_OFFSETS[`mb${e.button}`];
      if (offset) this.controlDv.setUint8(offset, 0, true);
    });

    this.canvas.addEventListener("mousemove", (e) => {
      this.controlDv.setUint16(CLIENT_CONTROL_OFFSETS.mx, e.clientX, true);
      this.controlDv.setUint16(CLIENT_CONTROL_OFFSETS.my, e.clientY, true);
    });

    window.addEventListener("keydown", (e) => {
      this.controlDv.setUint16(this.controlIndex, e.key.charCodeAt(0), true);
      this.controlDv.setUint8(this.controlIndex + 2, 1, true);
      this.controlIndex += CLIENT_CONTROL_OFFSETS.keyBlock;
    });

    window.addEventListener("keyup", (e) => {
      this.controlDv.setUint16(this.controlIndex, e.key.charCodeAt(0), true);
      this.controlDv.setUint8(this.controlIndex + 2, 0, true);
      this.controlIndex += CLIENT_CONTROL_OFFSETS.keyBlock;
    });

    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const v =
        this.controlDv.getInt16(CLIENT_CONTROL_OFFSETS.scrollDelta, true) +
        e.deltaY;
      this.controlU8[CLIENT_CONTROL_OFFSETS.scrollDelta] = v & 0xff;
      this.controlU8[CLIENT_CONTROL_OFFSETS.scrollDelta + 1] = (v >> 8) & 0xff;
      console.log(
        this.controlDv.getInt16(CLIENT_CONTROL_OFFSETS.scrollDelta, true),
      );
    });

    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.canvas.addEventListener("resize", () => this._resize());
  }

  _controlLoop() {
    setInterval(() => {
      this.connector.sendPacket(
        PACKET_TYPES.CONTROLS,
        this.controlU8.subarray(0, this.controlIndex),
        this.connection,
      );
      this.controlIndex = CLIENT_CONTROL_OFFSETS.keyLog;
    }, 1000 / 30);
  }

  _resize() {
    this.canvas.width = this.canvas.clientWidth || window.innerWidth;
    this.canvas.height = this.canvas.clientHeight || window.innerHeight;
    this.ctx.imageSmoothingEnabled = false;
  }
}

export { CerealClient, CLIENT_CONTROL_OFFSETS };
