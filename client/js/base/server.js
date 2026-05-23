import { CONFIG } from "/js/base/config.js";
import { CerealSpace } from "/js/base/space.js";
import {
  CerealEntity,
  BYTES_PER_BLOCK,
  BYTES_PER_ENTITY,
  BYTES_PER_HEADER,
} from "/js/base/entity.js";
import {
  CerealConnector,
  CerealPeer,
  PACKET_TYPES,
  MODES,
  STATUS,
} from "/js/base/connector.js";
import { CLIENT_CONTROL_OFFSETS } from "/js/base/client.js";

class Player {
  constructor(cnt, cs) {
    this.cnt = cnt;
    this.entity = new CerealEntity(cs, cs.addEntity());
    this.entity.px = CONFIG.CerealSpace.padding;
    this.entity.py = CONFIG.CerealSpace.padding;
    this.entity.w = 150;
    this.entity.h = 50;

    this.camera = {
      x: 1,
      y: 1,
      fov: 500,
    };
    this.controls = {
      mouse: {
        x: 0,
        y: 0,
        lmb: false,
        mmb: false,
        rmb: false,
        scroll: 0,
      },
      keyboard: {
        // populates with <char>: bool
      },
    };
  }

  tick() {
    // Update scroll
    this.controls.mouse.scroll *= 0.9;
    this.camera.fov += this.controls.mouse.scroll * 0.5;

    // Update entity
    this.entity.sync();
    if (this.entity.exists === false) return;

    // Facing
    this.entity.rot = Math.atan2(
      this.controls.mouse.y - (this.entity.py + this.entity.h * 0.5),
      this.controls.mouse.x - (this.entity.px + this.entity.w * 0.5),
    );

    // Movement
    const keyboard = this.controls.keyboard;
    const speed = 5;
    if (keyboard["w"] || keyboard["W"]) {
      this.entity.vy -= speed;
    }
    if (keyboard["s"] || keyboard["S"]) {
      this.entity.vy += speed;
    }
    if (keyboard["a"] || keyboard["A"]) {
      this.entity.vx -= speed;
    }
    if (keyboard["d"] || keyboard["D"]) {
      this.entity.vx += speed;
    }
  }

  updateCameraFromEntity() {
    this.entity.sync();
    if (this.entity.exists === false) return;
    this.camera.x = Math.min(
      65535,
      Math.max(0, this.entity.px + this.entity.w * 0.5),
    );
    this.camera.y = Math.min(
      65535,
      Math.max(0, this.entity.py + this.entity.h * 0.5),
    );
  }

  updateControls(controlsDv) {
    const mouse = this.controls.mouse;
    const keyboard = this.controls.keyboard;
    mouse.x = controlsDv.getUint16(CLIENT_CONTROL_OFFSETS.mx, true);
    mouse.y = controlsDv.getUint16(CLIENT_CONTROL_OFFSETS.my, true);
    mouse.scroll += controlsDv.getInt16(
      CLIENT_CONTROL_OFFSETS.scrollDelta,
      true,
    );
    mouse.lmb = controlsDv.getUint8(CLIENT_CONTROL_OFFSETS.mb0, true);
    mouse.mmb = controlsDv.getUint8(CLIENT_CONTROL_OFFSETS.mb1, true);
    mouse.rmb = controlsDv.getUint8(CLIENT_CONTROL_OFFSETS.mb2, true);
    for (
      let i = CLIENT_CONTROL_OFFSETS.keyLog;
      i < controlsDv.byteLength;
      i += CLIENT_CONTROL_OFFSETS.keyBlock
    ) {
      keyboard[String.fromCharCode(controlsDv.getUint16(i, true))] =
        controlsDv.getUint8(i + 2, true);
    }
  }
}

const SERVER_VIEW_OFFSETS = {
  x: 0, // 2
  y: 2, // 2
  fov: 4, // 2
  entities: 6, // rest
};

class Server {
  constructor() {
    this.connector = new CerealConnector(MODES.SERVER);
    this.cs = new CerealSpace(this.connector);

    this.players = new Map();

    this._setUpPackets();
    this._setUpLoops();
  }

  csTick() {
    this.cs.loopEntities((entity) => {
      // Movement
      movement(entity);

      // Collision
      if (this.cs.tick % CONFIG.CerealSpace.collisionInterval === 0)
        this.cs.getCollisions(entity, collide);

      // Engine
      keepInBounds(this.cs, entity);
    });
    if (this.cs.tick % CONFIG.CerealSpace.sortInterval === 0) this.cs.sort();
  }

  _setUpPackets() {
    this.connector.onPacket(PACKET_TYPES.SOCKET_CONNECT, (cnt, data, dv) => {
      console.log("Established new server connection");
    });

    this.connector.onPacket(PACKET_TYPES.OPEN, (cnt, data, dv) => {
      this.players.set(cnt, new Player(cnt, this.cs));
      this.connector.sendPacket(
        PACKET_TYPES.SPACE_INFO,
        this.cs.spaceInfoBuf,
        cnt,
      );
    });

    this.connector.onPacket(PACKET_TYPES.DISCONNECT, (cnt, data, dv) => {
      const player = this.players.get(cnt);
      player.entity.sync();
      if (player.entity.exists) this.cs.deleteEntity(player.entity.index);
      this.players.delete(cnt);
    });

    this.connector.onPacket(PACKET_TYPES.CONTROLS, (cnt, data, dv) => {
      if (cnt.status !== STATUS.OPEN) return;
      const player = this.players.get(cnt);
      player.updateControls(dv);
    });
  }

  _setUpLoops() {
    // Update game room data
    setInterval(() => {
      this.connector.sendPacket(PACKET_TYPES.SPACE_INFO, this.cs.spaceInfoBuf);
    }, 1000 / 2);

    // Misc. Player ticks
    setInterval(() => {
      for (let [cnt, player] of this.players) {
        player.tick();
      }
    }, 1000 / 8);

    // Tick Space
    setInterval(() => {
      this.cs.tickSpace(this.csTick.bind(this));
    }, 1000 / 30);

    // Update views
    setInterval(() => {
      for (let [cnt, player] of this.players) {
        player.updateCameraFromEntity();
        const fov = player.camera.fov & 0xffff;

        // camera
        this.connector.sendDv.setUint16(
          SERVER_VIEW_OFFSETS.x,
          player.camera.x,
          true,
        );
        this.connector.sendDv.setUint16(
          SERVER_VIEW_OFFSETS.y,
          player.camera.y,
          true,
        );
        this.connector.sendDv.setUint16(SERVER_VIEW_OFFSETS.fov, fov, true);

        // entities
        const x1 = player.camera.x - fov;
        const y1 = player.camera.y - fov;
        const x2 = player.camera.x + fov;
        const y2 = player.camera.y + fov;
        const ents = this.cs.query(x1, y1, x2, y2, undefined, 0, true);
        let entityLen = 0;
        for (let i = 0; i < ents.byteLength; i += BYTES_PER_BLOCK) {
          this.connector.sendU8.set(
            ents.subarray(i + BYTES_PER_HEADER, i + BYTES_PER_BLOCK),
            SERVER_VIEW_OFFSETS.entities + entityLen,
          );
          entityLen += BYTES_PER_ENTITY;
        }
        this.connector.sendPacket(
          PACKET_TYPES.VIEW,
          this.connector.sendU8.subarray(
            0,
            SERVER_VIEW_OFFSETS.entities + entityLen,
          ),
          cnt,
        );
      }
    }, 1000 / 30);
  }
}

function movement(entity) {
  if (entity.vx === 0 && entity.vy === 0) return;
  entity.px += entity.vx;
  entity.py += entity.vy;
  entity.vx *= 0.95;
  entity.vy *= 0.95;
}

function collide(entityA, entityB, damper = 0.9) {
  const centerDistanceX =
    entityA.px + entityA.w / 2 - (entityB.px + entityB.w / 2);
  const centerDistanceY =
    entityA.py + entityA.h / 2 - (entityB.py + entityB.h / 2);

  const overlapX = (entityA.w + entityB.w) / 2 - Math.abs(centerDistanceX);
  const overlapY = (entityA.h + entityB.h) / 2 - Math.abs(centerDistanceY);

  if (overlapX < overlapY) {
    const directionX = centerDistanceX >= 0 ? 1 : -1;
    const impulseX = overlapX * 0.5 * directionX;
    entityA.vx += Math.round(impulseX * damper);
    entityB.vx -= Math.round(impulseX * damper);
  } else {
    const directionY = centerDistanceY >= 0 ? 1 : -1;
    const impulseY = overlapY * 0.5 * directionY;
    entityA.vy += Math.round(impulseY * damper);
    entityB.vy -= Math.round(impulseY * damper);
  }
}

function keepInBounds(cs, ent) {
  const padding = cs.padding;
  const csW = cs.width - padding;
  const csH = cs.height - padding;
  const w = ent.w;
  const h = ent.h;

  // -,-
  let x1 = ent.px;
  let y1 = ent.py;
  let x2 = x1 + w;
  let y2 = y1 + h;
  if (x2 < padding) {
    x1 = ent.px = csW - w;
  } else if (x1 < padding) {
    x1 = ent.px = padding;
  }
  if (y2 < padding) {
    y1 = ent.py = csH - h;
  } else if (y1 < padding) {
    y1 = ent.py = padding;
  }

  // +,+
  x2 = x1 + w;
  y2 = y1 + h;
  if (csW < x1) {
    ent.px = padding;
  } else if (csW < x2) {
    ent.px = csW - w;
  }
  if (csH < y1) {
    ent.py = padding;
  } else if (csH < y2) {
    ent.py = csH - h;
  }
}

// If in worker context...
if (typeof window === "undefined" && typeof self !== "undefined") {
  const server = new Server();
  const peerIdToCC = new Map();

  self.onmessage = (e) => {
    const { type, channels, id } = e.data;
    let cc;
    switch (type) {
      case "set_channels":
        // Dont make client or server
        // Just wrapping data channels
        let cerealPeer = new CerealPeer();
        let openedChannels = 0;
        for (let channel of channels) {
          cerealPeer.setUpDataChannel(channel);

          channel.addEventListener("open", () => {
            openedChannels++;
            if (openedChannels === cerealPeer.EXPECTED_DATA_CHANNELS) {
              self.postMessage({ type: "peer_open", id: id });
            }
          });

          channel.addEventListener("close", () => {
            self.postMessage({ type: "close_peer", id: id });
          });
        }

        cc = server.connector.addConnection(cerealPeer);
        peerIdToCC.set(id, cc);
        break;

      case "close_channels":
        cc = peerIdToCC.get(id);
        cc.close();
        peerIdToCC.delete(id);
        break;
    }
  };
}

/*
function applyForce(pos, size, direction) {
  const radius = size * 10;
  const strength = size;

  cs.query(
    pos.x - radius,
    pos.y - radius,
    pos.x + radius,
    pos.y + radius,
    (ent) => {
      const dx = pos.x - (ent.px + ent.w / 2);
      const dy = pos.y - (ent.py + ent.h / 2);
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0.1 * radius && dist < radius) {
        const force = strength * (1 - dist / radius);
        ent.vx += (dx / dist) * force * direction;
        ent.vy += (dy / dist) * force * direction;
      }
      return false;
    },
  );
}

self.onmessage = (e) => {
  switch (e.data.type) {
    case "add":
      for (let i = 0; i < e.data.amount; i++) {
        let entity = new CerealEntity(cs, cs.addEntity());
        entity.px = e.data.px;
        entity.py = e.data.py;
        entity.w = e.data.w;
        entity.h = e.data.h;
        entity.vx = e.data.vx;
        entity.vy = e.data.vy;
      }
      break;
    case "force":
      applyForce(e.data.pos, e.data.size, e.data.dir);
      break;
    case "delete":
      cs.query(e.data.x1, e.data.y1, e.data.x2, e.data.y2, (ent) => {
        cs.deleteEntity(ent.index);
      });
      break;
  }
};

self.postMessage({ entityArray: cs.entityBuf, controlArray: cs.controlBuf });
*/

export { SERVER_VIEW_OFFSETS };
