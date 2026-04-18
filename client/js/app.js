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

let currentTool = 1; // 1: Placer, 2: Pull, 3: Push
let spawnSize = 30;

// Performance Buffers
let perfBuffers = {
  world: [],
  query: [],
  render: [],
};

// Values displayed on UI
let averages = {
  world: 0,
  query: 0,
  render: 0,
};

// --- Canvas Setup ---
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

function screenToWorld(screenX, screenY) {
  const worldX = (screenX - canvas.width / 2) / camera.zoom - camera.x;
  const worldY = (screenY - canvas.height / 2) / camera.zoom - camera.y;
  return { x: worldX, y: worldY };
}

// --- Input Handling ---
window.addEventListener("keydown", (e) => {
  if (e.key >= "1" && e.key <= "9") currentTool = parseInt(e.key);
  if (e.key === "+" || e.key === "=") spawnSize += 5;
  if (e.key === "-" || e.key === "_") spawnSize = Math.max(2, spawnSize - 5);
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

function spawnEntity(x, y, force) {
  let entity = new CerealEntity(cs, cs.addEntity());
  entity.px = x;
  entity.py = y;
  entity.w = spawnSize;
  entity.h = spawnSize;
  entity.vx = (force * 0.5 - force * Math.random()) * spawnSize;
  entity.vy = (force * 0.5 - force * Math.random()) * spawnSize;
}

// --- Main Loop ---
function loop() {
  const worldPos = screenToWorld(camera.lastMouse.x, camera.lastMouse.y);
  const toolRadius = spawnSize * 30;
  const toolStrength = spawnSize * 1;

  // 1. Tool Logic & Query Timing
  if (camera.isHolding) {
    if (currentTool === 1) {
      for (let i = 0; i < 100; i++)
        spawnEntity(worldPos.x, worldPos.y, toolRadius * 0.05);
    } else if (currentTool === 2 || currentTool === 3) {
      const isPush = currentTool === 3;

      const tQ0 = performance.now();
      cs.query(
        worldPos.x - toolRadius,
        worldPos.y - toolRadius,
        worldPos.x + toolRadius,
        worldPos.y + toolRadius,
        (ent) => {
          const dx = worldPos.x - (ent.px + ent.w / 2);
          const dy = worldPos.y - (ent.py + ent.h / 2);
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist > toolRadius * 0.15 && dist < toolRadius) {
            const falloff = 1 - dist / toolRadius;
            const force = toolStrength * falloff;
            const dir = isPush ? -1 : 1;
            ent.vx += (dx / dist) * force * dir;
            ent.vy += (dy / dist) * force * dir;
          }
          return false;
        },
      );
      perfBuffers.query.push(performance.now() - tQ0);
    }
  }

  // 2. Update World Timing
  const tW0 = performance.now();
  cs.worldLoop();
  perfBuffers.world.push(performance.now() - tW0);

  // 3. Render Timing
  const tR0 = performance.now();
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

  if (camera.isHolding && (currentTool === 2 || currentTool === 3)) {
    ctx.strokeStyle =
      currentTool === 2 ? "rgba(0, 255, 255, 0.4)" : "rgba(255, 120, 0, 0.4)";
    ctx.lineWidth = spawnSize * 0.4;
    ctx.beginPath();
    ctx.arc(worldPos.x, worldPos.y, toolRadius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  perfBuffers.render.push(performance.now() - tR0);

  // --- UI Overlay ---

  // 1. Draw the semi-transparent background box
  ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
  // (x, y, width, height) - adjusted to cover all lines of text
  ctx.fillRect(10, 15, 330, 195);

  // 2. Draw Text
  ctx.fillStyle = "white";
  ctx.font = "bold 20px monospace";
  const toolName =
    currentTool === 1
      ? "PLACER"
      : currentTool === 2
        ? "PULL"
        : currentTool === 3
          ? "PUSH"
          : "NONE";

  ctx.fillText(`TOOL: ${currentTool} (${toolName})`, 20, 40);
  ctx.fillText(`SIZE: ${spawnSize}`, 20, 70);
  ctx.fillText(`ENTITIES: ${cs.nextEntityId - 1}`, 20, 100);

  ctx.font = "14px monospace";
  ctx.fillText(
    `Radius: ${toolRadius.toFixed(0)} | Strength: ${toolStrength.toFixed(1)}`,
    20,
    125,
  );

  // Performance UI
  ctx.fillStyle = "#00ff00";
  ctx.fillText(`Avg World:  ${averages.world.toFixed(4)}ms`, 20, 155);
  ctx.fillText(`Avg Query:  ${averages.query.toFixed(4)}ms`, 20, 175);
  ctx.fillText(`Avg Render: ${averages.render.toFixed(4)}ms`, 20, 195);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

// Calculate averages every 1 second for a responsive UI
setInterval(() => {
  const calcAvg = (arr) =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  averages.world = calcAvg(perfBuffers.world);
  averages.query = calcAvg(perfBuffers.query);
  averages.render = calcAvg(perfBuffers.render);

  // Clear buffers
  perfBuffers.world = [];
  perfBuffers.query = [];
  perfBuffers.render = [];
}, 1000);
