import {
  CerealConnector,
  PACKET_TYPES,
  CONNECTOR_VER,
  MODES,
  SEND_BUF_SIZE,
} from "/js/base/connector.js";
import { SPACE_INFO_OFFSETS } from "/js/base/space.js";
import { CerealEntity, BYTES_PER_ENTITY } from "/js/base/entity.js";
import { SERVER_VIEW_OFFSETS } from "/js/base/server.js";
import { CONFIG } from "/js/base/config.js";

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

const lerp = (x, y, a) => x * (1 - a) + y * a;

class CerealClient {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = this.canvas.getContext("2d");
    this.bgGradient = this.ctx.createConicGradient(0, 0xffff >> 1, 0xffff >> 1);
    this.bgGradient.addColorStop(0, "#100817");
    this.bgGradient.addColorStop(0.33, "#646356");
    this.bgGradient.addColorStop(0.66, "#41373E");
    this.bgGradient.addColorStop(1, "#1D9D88");

    this.entityBuf = new Uint8Array(0);
    this.renderDict = new Uint8Array(
      CONFIG.CerealClient.maxEntities * BYTES_PER_ENTITY,
    );
    this.prevDict = new Uint8Array(
      CONFIG.CerealClient.maxEntities * BYTES_PER_ENTITY,
    );

    this.spaceInfo = {
      width: 1,
      height: 1,
      padding: 0,
      entityAmount: 0,
      tickTime: 0,
    };
    this.camera = {
      x: 0,
      y: 0,
      fov: 1,
      renderX: 0,
      renderY: 0,
      renderFov: 1,
      startX: 0,
      startY: 0,
      startFov: 1,
    };

    this.controlBuf = new ArrayBuffer(SEND_BUF_SIZE);
    this.controlU8 = new Uint8Array(this.controlBuf);
    this.controlDv = new DataView(this.controlBuf);
    this.controlIndex = CLIENT_CONTROL_OFFSETS.keyLog;

    this.avgRender = 1;
    this.lastViewPacket = Date.now();
    this.avgViewMs = 1;
    this.lastRender = performance.now();
    this.avgFrameMs = 1;

    this.viewLerp = 1;
    this.clampedViewLerp = 1;

    this.connector = new CerealConnector(MODES.CLIENT);
    this._setUpPackets();
    this._resize();
    this._setUpEvents();
    this._render();
    this._controlLoop();

    window.addEventListener("resize", this._resize.bind(this));
  }

  _lerp() {
    // Camera
    this.camera.renderX = Math.max(
      0,
      lerp(this.camera.startX, this.camera.x, this.viewLerp),
    );
    this.camera.renderY = Math.max(
      0,
      lerp(this.camera.startY, this.camera.y, this.viewLerp),
    );
    this.camera.renderFov = Math.max(
      0,
      lerp(this.camera.startFov, this.camera.fov, this.clampedViewLerp),
    );

    // Entities
    const dvA = new DataView(
      this.entityBuf.buffer,
      this.entityBuf.byteOffset,
      this.entityBuf.byteLength,
    );
    let entityNet = new CerealEntity({ dv: dvA }, 0, true); // cannot call sync
    const dvB = new DataView(this.renderDict.buffer);
    let entityRen = new CerealEntity({ dv: dvB }, 0, true); // cannot call sync
    const dvC = new DataView(this.prevDict.buffer);
    let entityPrv = new CerealEntity({ dv: dvC }, 0, true); // cannot call sync

    for (let i = 0; i < this.entityBuf.byteLength; i += BYTES_PER_ENTITY) {
      entityNet.index = i;
      entityRen.index = entityNet.clientId * BYTES_PER_ENTITY;
      entityPrv.index = entityRen.index;

      // lerp any values here...
      // Note: Technically you only need to care
      // about the values you actually use in the client.
      // Here I have done them all as an example
      entityRen.px = Math.max(
        0,
        lerp(entityPrv.px, entityNet.px, this.viewLerp),
      );
      entityRen.py = Math.max(
        0,
        lerp(entityPrv.py, entityNet.py, this.viewLerp),
      );
      entityRen.vx = lerp(entityPrv.vx, entityNet.vx, this.viewLerp);
      entityRen.vy = lerp(entityPrv.vy, entityNet.vy, this.viewLerp);
      entityRen.w = Math.max(0, lerp(entityPrv.w, entityNet.w, this.viewLerp));
      entityRen.h = Math.max(0, lerp(entityPrv.h, entityNet.h, this.viewLerp));
      entityRen.clientId = entityNet.clientId;
    }
  }

  _render() {
    requestAnimationFrame(this._render.bind(this));

    this.avgFrameMs =
      this.avgFrameMs * 0.95 + (performance.now() - this.lastRender) * 0.05;
    this.lastRender = performance.now();

    this.viewLerp =
      Math.max(
        0,
        Math.min(5, (Date.now() - this.lastViewPacket) / this.avgViewMs),
      ) || 0.01;
    this.clampedViewLerp = Math.min(1, this.viewLerp);

    this._lerp();

    let { canvas, ctx, camera, spaceInfo, entityBuf } = this;
    const s = performance.now();

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    const zoom = Math.max(canvas.width, canvas.height) / (camera.renderFov * 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-camera.renderX, -camera.renderY);

    ctx.fillStyle = this.bgGradient;
    ctx.fillRect(
      spaceInfo.padding,
      spaceInfo.padding,
      spaceInfo.width - spaceInfo.padding * 2,
      spaceInfo.height - spaceInfo.padding * 2,
    );

    ctx.fillStyle = "#FFFFFF";

    const dvA = new DataView(
      this.entityBuf.buffer,
      this.entityBuf.byteOffset,
      this.entityBuf.byteLength,
    );
    let entityA = new CerealEntity({ dv: dvA }, 0, true); // cannot call sync
    const dvB = new DataView(this.renderDict.buffer);
    let entityB = new CerealEntity({ dv: dvB }, 0, true); // cannot call sync
    for (let i = 0; i < entityBuf.byteLength; i += BYTES_PER_ENTITY) {
      entityA.index = i;
      entityB.index = entityA.clientId * BYTES_PER_ENTITY;
      const x = entityB.px;
      const y = entityB.py;
      const w = entityB.w;
      const h = entityB.h;
      ctx.fillRect(x, y, w, h);
    }
    ctx.restore();
    this.avgRender = this.avgRender * 0.95 + (performance.now() - s) * 0.05;
  }

  _setUpPackets() {
    this.connector.onPacket(PACKET_TYPES.SOCKET_CONNECT, (cnt, data, dv) => {
      console.log("Established new client connection");
      // Start opening process
      this.connector.sendDv.setUint16(0, CONNECTOR_VER, true);
      this.connector.sendPacket(
        PACKET_TYPES.CONNECT,
        this.connector.sendU8.subarray(0, 2),
        cnt,
        true,
      );
    });

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
      this.spaceInfo.padding = dv.getUint16(SPACE_INFO_OFFSETS.padding, true);
      this.spaceInfo.entityAmount = dv.getUint32(
        SPACE_INFO_OFFSETS.entityAmount,
        true,
      );
      this.spaceInfo.tickTime =
        dv.getUint32(SPACE_INFO_OFFSETS.tickTime, true) * 0.01;
    });

    this.connector.onPacket(PACKET_TYPES.VIEW, (cnt, data, dv) => {
      this.avgViewMs =
        this.avgViewMs * 0.95 + (Date.now() - this.lastViewPacket) * 0.05;
      this.lastViewPacket = Date.now();

      this.camera.startX = this.camera.renderX;
      this.camera.startY = this.camera.renderY;
      this.camera.startFov = this.camera.renderFov;
      this.camera.x = dv.getUint16(SERVER_VIEW_OFFSETS.x, true);
      this.camera.y = dv.getUint16(SERVER_VIEW_OFFSETS.y, true);
      this.camera.fov = dv.getUint16(SERVER_VIEW_OFFSETS.fov, true);

      this.prevDict.set(this.renderDict);

      this.entityBuf = data.slice(
        SERVER_VIEW_OFFSETS.entities,
        data.byteLength,
      );
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
      if (e.key === "Shift") return;
      this.controlDv.setUint16(this.controlIndex, e.key.charCodeAt(0), true);
      this.controlDv.setUint8(this.controlIndex + 2, 1, true);
      this.controlIndex += CLIENT_CONTROL_OFFSETS.keyBlock;
    });

    window.addEventListener("keyup", (e) => {
      if (e.key === "Shift") return;
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
    });

    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.canvas.addEventListener("resize", () => this._resize());
  }

  _controlLoop() {
    setInterval(() => {
      this.connector.sendPacket(
        PACKET_TYPES.CONTROLS,
        this.controlU8.subarray(0, this.controlIndex),
      );
      this.controlDv.setUint16(CLIENT_CONTROL_OFFSETS.scrollDelta, 0, true);
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
