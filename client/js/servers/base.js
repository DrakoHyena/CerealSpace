import { CerealSpace, tickCerealSpace } from "/js/spaces/base.js";
import { CerealEntity } from "/js/entities/base.js";

const cs = new CerealSpace();

setInterval(() => {
  tickCerealSpace(cs);
}, 1000 / 30);

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
