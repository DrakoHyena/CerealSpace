import { CerealSpace, tickCerealSpace } from "/js/spaces/base.js";
import { CerealEntity } from "/js/entities/base.js";

const cs = new CerealSpace();

setInterval(() => {
  tickCerealSpace(cs);
}, 1000 / 30);

self.onmessage = (e) => {
  switch (e.data.type) {
    case "add":
      let entity = new CerealEntity(cs, cs.addEntity());
      entity.px = e.data.px;
      entity.py = e.data.py;
      entity.w = e.data.w;
      entity.h = e.data.h;
      entity.vx = e.data.vx;
      entity.vy = data.vy;
      break;
  }
};

self.postMessage({ array: cs.entityBuf });
