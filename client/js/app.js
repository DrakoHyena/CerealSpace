import { CerealSpace, CerealEntity } from "/js/src.js";

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// --- Configuration & State ---
let cs = new CerealSpace();
let camera = {
  x: -5000,
  y: -5000,
  zoom: 0.07,
  isHolding: false,
  isDragging: false,
  lastMouse: { x: 0, y: 0 },
};

let spawnSize = 30; // Default size for new entities
let loopPerformanceBuffer = []; // To calculate average worldLoop time

// --- Canvas Setup ---
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// --- Coordinate Conversion ---
function screenToWorld(screenX, screenY) {
  const worldX = (screenX - canvas.width / 2) / camera.zoom - camera.x;
  const worldY = (screenY - canvas.height / 2) / camera.zoom - camera.y;
  return { x: worldX, y: worldY };
}

// --- Input Handling ---

// Keyboard for size adjustment
window.addEventListener("keydown", (e) => {
  if (e.key === "+" || e.key === "=") {
    spawnSize += 5;
    console.log(`Spawn Size: ${spawnSize}`);
  }
  if (e.key === "-" || e.key === "_") {
    spawnSize = Math.max(2, spawnSize - 5); // Don't let it go below 2
    console.log(`Spawn Size: ${spawnSize}`);
  }
});

canvas.addEventListener("mousedown", (e) => {
  if (e.button === 0) camera.isHolding = true;
  if (e.button === 1 || e.button === 2 || e.shiftKey) {
    camera.isDragging = true;
    camera.lastMouse = { x: e.clientX, y: e.clientY };
  }
});

window.addEventListener("mousemove", (e) => {
  if (camera.isDragging) {
    const dx = e.clientX - camera.lastMouse.x;
    const dy = e.clientY - camera.lastMouse.y;
    camera.x += dx / camera.zoom;
    camera.y += dy / camera.zoom;
  }
  camera.lastMouse = { x: e.clientX, y: e.clientY };
});

window.addEventListener("mouseup", (e) => {
  if (e.button === 0) camera.isHolding = false;
  camera.isDragging = false;
});

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener(
  "wheel",
  (e) => {
    const zoomSpeed = 1.1;
    if (e.deltaY < 0) camera.zoom *= zoomSpeed;
    else camera.zoom /= zoomSpeed;
  },
  { passive: true },
);

// --- Entity Logic ---
function spawnEntity(x, y) {
  let entity = new CerealEntity(cs, cs.addEntity());
  entity.px = x;
  entity.py = y;
  // Use the dynamic spawnSize
  entity.w = spawnSize;
  entity.h = spawnSize;
  entity.vx = (50 - 100 * Math.random()) * spawnSize;
  entity.vy = (50 - 100 * Math.random()) * spawnSize;
}

// --- Main Loop ---
function loop() {
  // 1. Handle Spawning
  if (camera.isHolding) {
    for (let i = 0; i < 50; i++) {
      const worldPos = screenToWorld(camera.lastMouse.x, camera.lastMouse.y);
      spawnEntity(worldPos.x, worldPos.y);
    }
  }

  // 2. Update World & Track Time
  const t0 = performance.now();
  cs.worldLoop();
  const t1 = performance.now();
  loopPerformanceBuffer.push(t1 - t0);

  // 3. Render
  ctx.fillStyle = "grey";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(camera.x, camera.y);

  ctx.fillStyle = "black";
  cs.loopEntities((entity) => {
    ctx.fillRect(entity.px, entity.py, entity.w, entity.h);
  });

  ctx.restore();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

// Performance logging (every 3 seconds)
setInterval(() => {
  const count = cs.nextEntryId;
  const avgTime =
    loopPerformanceBuffer.length > 0
      ? loopPerformanceBuffer.reduce((a, b) => a + b, 0) /
        loopPerformanceBuffer.length
      : 0;

  console.log(
    `Entities: ${count} | Avg worldLoop: ${avgTime.toFixed(4)}ms | Size: ${spawnSize}`,
  );

  // Reset buffer for next 3 seconds
  loopPerformanceBuffer = [];
}, 3000);
