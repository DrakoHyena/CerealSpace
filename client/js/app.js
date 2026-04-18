import { CerealSpace, CerealEntity } from "/js/ceralSpaceVarients/base.js";
import { CerealViewer } from "/js/viewer.js";

const canvas = document.getElementById("canvas");
const cs = new CerealSpace();
const viewer = new CerealViewer(canvas, cs, CerealEntity);
viewer.setTool("1", "Spawn Entity", (pos) => {
  for (let i = 0; i < viewer.spawnAmount; i++) {
    let entity = new CerealEntity(cs, cs.addEntity());
    entity.px = pos.x;
    entity.py = pos.y;
    entity.w = viewer.spawnSize;
    entity.h = viewer.spawnSize;
    entity.vx = (Math.random() - 0.5) * 10;
    entity.vy = (Math.random() - 0.5) * 10;
  }
});
