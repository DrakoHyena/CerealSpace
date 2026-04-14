import { CeralSpace, CeralEntity } from "/js/src.js";

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
function resizeCanvas() {
  ctx.imageSmoothingEnabled = false;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();
let cs = new CeralSpace();

setInterval(() => {
  let start = performance.now();
  cs.worldLoop();
  console.log(
    `Processed ${cs.nextEntryId} entities in ${performance.now() - start}ms`,
  );
  ctx.fillStyle = "grey";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(0.1, 0.1);
  ctx.translate(-5000, -5000);
  ctx.fillStyle = "black";
  cs.loopEntities((entity) => {
    ctx.fillRect(entity.px, entity.py, entity.w, entity.h);
  });
  ctx.restore();
}, 30 / 1000);

setInterval(console.clear, 3000);

setInterval(() => {
  let entity = new CeralEntity(cs, cs.addEntity());
  entity.px = 5000;
  +500 * Math.random();
  entity.py = 5000;
  +500 * Math.random();
  entity.w = 10 + 20 * Math.random();
  entity.h = 10 + 20 * Math.random();
  entity.vx = 100 - 200 * Math.random();
  entity.vy = 100 - 200 * Math.random();
});
