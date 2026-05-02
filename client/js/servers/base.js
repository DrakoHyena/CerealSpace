import { CerealSpace, tickCerealSpace } from "/js/spaces/base.js";
import { CerealEntity } from "/js/entities/base.js";
import {
  CerealConnector,
  PACKET_TYPES,
  MODES,
  STATUS,
} from "/js/connectors/base.js";
import { CLIENT_CONTROL_OFFSETS } from "/js/clients/nubase.js";

const connector = new CerealConnector(MODES.SERVER);
const connection = connector.addConnection(self);
const cs = new CerealSpace(connector);

class Player {
  constructor(cnt) {
    this.cnt = cnt;
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
    console.log(this.controls.keyboard, this.controls.mouse);
  }
}
const players = new Map();

connector.onPacket(PACKET_TYPES.OPEN, (cnt, data, dv) => {
  players.set(cnt, new Player(cnt));
  connector.sendPacket(PACKET_TYPES.SPACE_INFO, cs.spaceInfoBuf, cnt);
});

connector.onPacket(PACKET_TYPES.DISCONNECT, (cnt, data, dv) => {
  players.delete(cnt);
});

connector.onPacket(PACKET_TYPES.CONTROLS, (cnt, data, dv) => {
  if (cnt.status !== STATUS.OPEN) return;
  const player = players.get(cnt);
  player.updateControls(dv);
});

setInterval(() => {
  connector.sendPacket(PACKET_TYPES.SPACE_INFO, cs.spaceInfoBuf);
}, 1000 / 2);

setInterval(() => {
  for (let [cnt, player] of players) {
    player.tick();
  }
}, 1000 / 8);

setInterval(() => {
  tickCerealSpace(cs);
}, 1000 / 30);

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
