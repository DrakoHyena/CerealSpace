import {
  BYTES_PER_BLOCK,
  BYTES_PER_HEADER,
  CEREAL_ENTITY_OFFSETS,
} from "/js/entities/base.js";
import { CONFIG } from "/js/configs/base.js";

export class CerealClient {
  constructor(canvas, serverWorker, buf) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    if (!this.canvas.hasAttribute("tabindex")) {
      this.canvas.setAttribute("tabindex", "0");
    }
    this.canvas.style.outline = "none";

    this.serverWorker = serverWorker;
    this.buf = buf;
    this.dv = new DataView(this.buf);

    this.camera = {
      x: -((2 ** 16) >> 1),
      y: -((2 ** 16) >> 1),
      zoom: 0.5,
      isHolding: false,
      isDragging: false,
      lastMouse: { x: 0, y: 0 },
    };

    this.spawnSize = 10;
    this.spawnAmount = 10;
    this.currentToolKey = "1";
    this.tools = {};
    this.repeatAmnt = 1;

    this.perf = {
      buffers: { world: [], tools: [], render: [] },
      averages: { world: 0, tools: 0, render: 0 },
    };

    this.setupTools();
    this.initEvents();
    this.resize();
    this.startLoops();
  }

  setTool(key, name, callback) {
    this.tools[key.toString()] = { name, callback };
  }

  setupTools() {
    this.setTool("1", "Spawn Entity", (pos) => {
      for (let i = 0; i < this.spawnAmount; i++) {
        serverWorker.postMessage({
          type: "add",
          px: pos.x,
          py: pos.y,
          w: this.spawnSize,
          h: this.spawnSize,
          vx: (Math.random() - 0.5) * 2000,
          vy: (Math.random() - 0.5) * 2000,
        });
      }
    });

    for (let i = 1; i <= 7; i++) {
      this.setTool(i, "Nothing", (pos) => {});
    }

    this.setTool("8", "Delete", (pos) => {
      const size = this.spawnSize * 10;
      serverWorker.postMessage({
        type: "delete",
        x1: pos.x - size,
        y1: pos.y - size,
        x2: pos.x + size,
        y2: pos.y + size,
      });
    });

    function applyForce(pos, direction) {
      const radius = this.spawnSize * 10;
      const strength = this.spawnSize;

      this.cs.query(
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

    this.setTool("9", "Push", (pos) => {
      this.serverWorker.postMessage({
        type: "force",
        dir: -1,
        x: pos.x,
        y: pos.y,
      });
    });
    this.setTool("0", "Pull", (pos) => {
      this.serverWorker.postMessage({
        type: "force",
        dir: 1,
        x: pos.x,
        y: pos.y,
      });
    });
  }

  screenToWorld(sx, sy) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (sx - rect.left) * (this.canvas.width / rect.width);
    const y = (sy - rect.top) * (this.canvas.height / rect.height);
    return {
      x: (x - this.canvas.width / 2) / this.camera.zoom - this.camera.x,
      y: (y - this.canvas.height / 2) / this.camera.zoom - this.camera.y,
    };
  }

  initEvents() {
    const c = this.canvas;
    c.addEventListener("mousedown", (e) => {
      if (e.button === 0) this.camera.isHolding = true;
      if (e.button === 1 || e.button === 2) this.camera.isDragging = true;
      this.camera.lastMouse = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener("mousemove", (e) => {
      if (this.camera.isDragging) {
        this.camera.x +=
          (e.clientX - this.camera.lastMouse.x) / this.camera.zoom;
        this.camera.y +=
          (e.clientY - this.camera.lastMouse.y) / this.camera.zoom;
      }
      this.camera.lastMouse = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.camera.isHolding = false;
      if (e.button === 1 || e.button === 2) this.camera.isDragging = false;
    });

    c.addEventListener("keydown", (e) => {
      if (e.repeat) {
        this.repeatAmnt += 1;
      } else {
        this.repeatAmnt = 1;
      }
      if (this.tools[e.key]) this.currentToolKey = e.key;
      if (e.key === "+" || e.key === "=") this.spawnSize += this.repeatAmnt;
      if (e.key === "-" || e.key === "_")
        this.spawnSize = Math.max(1, this.spawnSize - this.repeatAmnt);
      if (e.key === "]" || e.key === "}") this.spawnAmount += this.repeatAmnt;
      if (e.key === "[" || e.key === "{")
        this.spawnAmount = Math.max(1, this.spawnAmount - this.repeatAmnt);
    });

    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const zoomSpeed = 1.1;
        if (e.deltaY < 0) this.camera.zoom *= zoomSpeed;
        else this.camera.zoom /= zoomSpeed;
      },
      { passive: false },
    );

    c.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    this.canvas.width = this.canvas.clientWidth || window.innerWidth;
    this.canvas.height = this.canvas.clientHeight || window.innerHeight;
    this.ctx.imageSmoothingEnabled = false;
  }

  startLoops() {
    const tick = () => {
      const worldPos = this.screenToWorld(
        this.camera.lastMouse.x,
        this.camera.lastMouse.y,
      );

      if (this.camera.isHolding && this.tools[this.currentToolKey]) {
        this.tools[this.currentToolKey].callback(worldPos, this);
      }

      this.render(worldPos);
      requestAnimationFrame(tick);
    };

    setInterval(() => {
      const avg = (arr) =>
        arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      this.perf.averages.world = avg(this.perf.buffers.world);
      this.perf.averages.tools = avg(this.perf.buffers.tools);
      this.perf.averages.render = avg(this.perf.buffers.render);
      this.perf.buffers.world = [];
      this.perf.buffers.tools = [];
      this.perf.buffers.render = [];
    }, 1000);

    requestAnimationFrame(tick);
  }

  render(worldPos) {
    const tR0 = performance.now();
    const { ctx, canvas, camera, cs } = this;

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(camera.x, camera.y);

    ctx.fillStyle = "grey";

    const end =
      CONFIG.CerealSpace.maxEntities * BYTES_PER_BLOCK - BYTES_PER_BLOCK;
    for (let i = 0; i < end; i += BYTES_PER_BLOCK) {
      let offset = i + BYTES_PER_HEADER;
      const x = this.dv.getUint16(offset + CEREAL_ENTITY_OFFSETS.px);
      const y = this.dv.getUint16(offset + CEREAL_ENTITY_OFFSETS.py);
      const w = this.dv.getUint16(offset + CEREAL_ENTITY_OFFSETS.w);
      const h = this.dv.getUint16(offset + CEREAL_ENTITY_OFFSETS.h);
      ctx.fillRect(x, y, w, h);
    }

    if (this.camera.isHolding) {
      this.drawToolIndicator(ctx, worldPos);
    }

    ctx.restore();
    this.perf.buffers.render.push(performance.now() - tR0);
    //    this.drawUI();
  }

  drawToolIndicator(ctx, pos) {
    let color = "white";
    let radius = this.spawnSize;
    if (this.currentToolKey === "8") {
      color = "red";
      radius *= 10;
    } else if (this.currentToolKey === "9") {
      color = "orange";
      radius *= 10;
    } else if (this.currentToolKey === "0") {
      color = "cyan";
      radius *= 10;
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = 2 / this.camera.zoom;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  drawUI() {
    const { averages } = this.perf;
    const ctx = this.ctx;

    const baseScale = Math.min(
      this.canvas.width / 1000,
      this.canvas.height / 700,
    );
    const uiScale = Math.max(0.6, Math.min(baseScale, 2.5));

    const padding = 20 * uiScale;
    const fontSize = 13 * uiScale;
    const lineSpacing = 18 * uiScale;
    const boxWidth = 350 * uiScale;
    const boxHeight = 160 * uiScale;

    ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
    ctx.fillRect(10 * uiScale, 10 * uiScale, boxWidth, boxHeight);

    ctx.font = `${Math.round(fontSize)}px monospace`;
    ctx.textBaseline = "top";

    let currX = 10 * uiScale + padding;
    let currY = 10 * uiScale + padding;

    const drawLine = (text, color = "white") => {
      ctx.fillStyle = color;
      ctx.fillText(text, currX, currY);
      currY += lineSpacing;
    };

    const toolName = this.tools[this.currentToolKey]?.name || "Unknown";
    drawLine(`Tool: ${this.currentToolKey} - ${toolName}`);
    drawLine(`Size: ${this.spawnSize} | Amount: ${this.spawnAmount || 1}`);
    drawLine(`Entities: ${this.cs.freeIndex / BYTES_PER_BLOCK}`);

    currY += 5 * uiScale;

    const targetTime = 1000 / 33;

    drawLine(
      `World: ${averages.world.toFixed(3)}ms (target: ${(targetTime - averages.render).toFixed(2)})`,
      "#00ff00",
    );
    drawLine(`Tools: ${averages.tools.toFixed(3)}ms`, "#00ff00");
    drawLine(
      `Render : ${averages.render.toFixed(3)}ms (target: ${(targetTime - averages.world).toFixed(2)})`,
      "#00ff00",
    );

    // Calc Slowdown
    const totalTime = averages.world + averages.tools + averages.render;
    const slowdown = (totalTime / (1000 / 30) - 1) * 100;
    const slowColor = slowdown > 0 ? "#FF4444" : "#AAAAAA";

    drawLine(`Est Slowdown: ${slowdown.toFixed(2)}%`, slowColor);
  }
}
