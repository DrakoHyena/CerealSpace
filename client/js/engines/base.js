const CEREAL_ENTITY_OFFSETS = parseOffsets({
  px: 2,
  py: 2,
  vx: 4,
  vy: 4,
  w: 2,
  h: 2,
});

const CEREAL_HEADER_OFFSETS = parseOffsets({
  id: 4,
});

const BYTES_PER_ENTITY = CEREAL_ENTITY_OFFSETS._totalBytes;
const BYTES_PER_HEADER = CEREAL_HEADER_OFFSETS._totalBytes;
const BYTES_PER_BLOCK = BYTES_PER_ENTITY + BYTES_PER_HEADER;

class CerealEntity {
  constructor(cerealSpace, index) {
    this.cs = cerealSpace;
    this.id = this.cs.dv.getUint32(
      index - BYTES_PER_HEADER + CEREAL_HEADER_OFFSETS.id,
      true,
    );
    this.index = index;
  }

  sync() {
    this.index = this.cs.idToDataIndex[this.id];
  }

  get px() {
    return this.cs.dv.getUint16(this.index + CEREAL_ENTITY_OFFSETS.px, true);
  }
  set px(v) {
    this.cs.dv.setUint16(this.index + CEREAL_ENTITY_OFFSETS.px, v, true);
  }

  get py() {
    return this.cs.dv.getUint16(this.index + CEREAL_ENTITY_OFFSETS.py, true);
  }
  set py(v) {
    this.cs.dv.setUint16(this.index + CEREAL_ENTITY_OFFSETS.py, v, true);
  }

  get vx() {
    return this.cs.dv.getInt32(this.index + CEREAL_ENTITY_OFFSETS.vx, true);
  }
  set vx(v) {
    this.cs.dv.setInt32(this.index + CEREAL_ENTITY_OFFSETS.vx, v, true);
  }

  get vy() {
    return this.cs.dv.getInt32(this.index + CEREAL_ENTITY_OFFSETS.vy, true);
  }
  set vy(v) {
    this.cs.dv.setInt32(this.index + CEREAL_ENTITY_OFFSETS.vy, v, true);
  }

  get w() {
    return this.cs.dv.getUint16(this.index + CEREAL_ENTITY_OFFSETS.w, true);
  }
  set w(v) {
    this.cs.dv.setUint16(this.index + CEREAL_ENTITY_OFFSETS.w, v, true);
  }

  get h() {
    return this.cs.dv.getUint16(this.index + CEREAL_ENTITY_OFFSETS.h, true);
  }
  set h(v) {
    this.cs.dv.setUint16(this.index + CEREAL_ENTITY_OFFSETS.h, v, true);
  }
}

class CerealSpace {
  constructor() {
    this.maxEntities = 0x100000 >> 1;
    this.maxEntitiesBytes = this.maxEntities * BYTES_PER_BLOCK;

    this.entityBuf = new SharedArrayBuffer(this.maxEntitiesBytes);
    this.u8 = new Uint8Array(this.entityBuf);
    this.dv = new DataView(this.entityBuf, 0, this.maxEntitiesBytes);

    this.freeIndex = 0;

    this.freeIds = new Uint32Array(this.maxEntities);
    for (let i = 0; i < this.maxEntities; i++) {
      this.freeIds[i] = i + 1;
    }
    this.lastFreeId = this.maxEntities - 1;

    this.idToBlockBuf = new SharedArrayBuffer(this.maxEntities * 4);
    this.idToBlock = new Uint32Array(this.idMapBuf);

    // block to sorted index
    this.rankToIndexBufA = new SharedArrayBuffer(this.maxEntities * 4);
    this.rankToIndexBufB = new SharedArrayBuffer(this.maxEntities * 4);
    this.rankToIndexA = new Uint32Array(this.rankToIndexBufA);
    for (let i = 0; i < this.maxEntities; i++) this.rankToIndexA[i] = i;
    this.rankToIndexB = new Uint32Array(this.rankToIndexBufB);
    this.activeBlockToIndex = 0;
    this.rankToIndex = this.rankToIndexBufA;

    this.mortonKeysBufA = new SharedArrayBuffer(this.maxEntities * 4);
    this.mortonKeysA = new Uint32Array(this.mortonKeysBufA);
    this.mortonKeysBufB = new SharedArrayBuffer(this.maxEntities * 4);
    this.mortonKeysB = new Uint32Array(this.mortonKeysBufB);
    this.mortonKeys = this.mortonKeysA;

    this.isSorting = false;
    this.sortWorker = new Worker("/js/engines/lib/sortWorker.js");
    this.sortWorker.onmessage = (e) => {
      if (e.data.type === "complete") {
        if (this.activeBlockToIndex === 0) {
          this.activeBlockToIndex = 1;
          this.rankToIndex = this.rankToIndexB;
          this.mortonKeys = this.mortonKeysB; // SWAP KEYS HERE
        } else {
          this.activeBlockToIndex = 0;
          this.rankToIndex = this.rankToIndexA;
          this.mortonKeys = this.mortonKeysA; // SWAP KEYS HERE
        }
        this.isSorting = false;
      }
    };
    this.sortWorker.postMessage({
      type: "init",
      entityBuf: this.entityBuf,
      rankToIndexBufA: this.rankToIndexBufA,
      rankToIndexBufB: this.rankToIndexBufB,
      mortonKeysBufA: this.mortonKeysBufA, // Buffer A
      mortonKeysBufB: this.mortonKeysBufB, // Buffer B
      pxOffset: CEREAL_ENTITY_OFFSETS.px,
      pyOffset: CEREAL_ENTITY_OFFSETS.py,
      BYTES_PER_BLOCK: BYTES_PER_BLOCK,
      BYTES_PER_HEADER: BYTES_PER_HEADER,
    });

    this._worldLoopEntity = new CerealEntity(this, BYTES_PER_HEADER);
    this._loopEntity = new CerealEntity(this, BYTES_PER_HEADER);
    this._collisionEntity = new CerealEntity(this, BYTES_PER_HEADER);
    this._queryEntity = new CerealEntity(this, BYTES_PER_HEADER);
  }

  addEntity() {
    const blockIndex = this.freeIndex / BYTES_PER_BLOCK;
    const blockStart = this.freeIndex;
    this.u8.fill(0, blockStart, blockStart + BYTES_PER_BLOCK);

    const id = this.freeIds[this.lastFreeId--];
    this.dv.setUint32(blockStart + CEREAL_HEADER_OFFSETS.id, id, true);

    this.idToBlock[id] = blockIndex;
    this.freeIndex += BYTES_PER_BLOCK;
    return blockStart + BYTES_PER_HEADER;
  }

  deleteEntity(dataIndex) {
    const blockStart = dataIndex - BYTES_PER_HEADER;
    const lastBlockStart = this.freeIndex - BYTES_PER_BLOCK;

    this.lastFreeId++;
    this.freeIds[this.lastFreeId] = this.dv.getUint32(
      blockStart + CEREAL_HEADER_OFFSETS.id,
      true,
    );

    if (blockStart !== lastBlockStart) {
      this.u8.copyWithin(blockStart, lastBlockStart, this.freeIndex);
      this.idToDataIndex[
        (this.dv.getUint32(blockStart + CEREAL_HEADER_OFFSETS.id), true)
      ] = blockStart + BYTES_PER_HEADER;
    }

    this.freeIndex -= BYTES_PER_BLOCK;
  }

  sort() {
    if (this.freeIndex <= BYTES_PER_BLOCK * 2) return;
    const blockCount = this.freeIndex / BYTES_PER_BLOCK;
    this.sortWorker.postMessage({
      type: "sort",
      blockCount: blockCount,
      activeBlockToIndex: this.activeBlockToIndex,
    });
    this.isSorting = true;
  }

  loopEntities(cb) {
    const totalBlocks = this.freeIndex / BYTES_PER_BLOCK;

    for (let i = totalBlocks - 1; i >= 0; i--) {
      const blockIdx = this.rankToIndex[i];
      const dataIndex = blockIdx * BYTES_PER_BLOCK + BYTES_PER_HEADER;

      this._loopEntity.index = dataIndex;
      this._loopEntity.id = this.dv.getUint32(
        blockIdx * BYTES_PER_BLOCK + CEREAL_HEADER_OFFSETS.id,
        true,
      );

      cb(this._loopEntity);
    }
  }

  getCollisions(rank, entity, callback) {
    const totalBlocks = this.freeIndex / BYTES_PER_BLOCK;
    if (rank >= totalBlocks - 1) return;

    // 1. Resolve Physical Block A (Source)
    const blockIdxA = this.rankToIndex[rank];
    const dataOffA = blockIdxA * BYTES_PER_BLOCK + BYTES_PER_HEADER;

    // 2. Get Source Bounds (Narrow Phase)
    const ax1 = this.dv.getUint16(dataOffA + CEREAL_ENTITY_OFFSETS.px, true);
    const ay1 = this.dv.getUint16(dataOffA + CEREAL_ENTITY_OFFSETS.py, true);
    const awA = this.dv.getUint16(dataOffA + CEREAL_ENTITY_OFFSETS.w, true);
    const ahA = this.dv.getUint16(dataOffA + CEREAL_ENTITY_OFFSETS.h, true);
    const ax2 = ax1 + awA;
    const ay2 = ay1 + ahA;

    // 3. Define Morton Cutoff (Spatial Optimization)
    const keyCutoff =
      (MORTON_LUT[ax2 & 0xffff] | (MORTON_LUT[ay2 & 0xffff] << 1)) >>> 0;

    // 4. Scan forward in the sorted array (j > rank)
    // This ensures every unique pair (A, B) is checked only once.
    const maxItrs = 124;
    const end = Math.min(totalBlocks, rank + 1 + maxItrs);

    for (let j = rank + 1; j < end; j++) {
      const bKey = this.mortonKeys[j];
      if (bKey > keyCutoff) break;

      const blockIdxB = this.rankToIndex[j];
      const dataOffB = blockIdxB * BYTES_PER_BLOCK + BYTES_PER_HEADER;

      // 5. Narrow Phase AABB
      const bx1 = this.dv.getUint16(dataOffB + CEREAL_ENTITY_OFFSETS.px, true);
      const by1 = this.dv.getUint16(dataOffB + CEREAL_ENTITY_OFFSETS.py, true);
      const bwB = this.dv.getUint16(dataOffB + CEREAL_ENTITY_OFFSETS.w, true);
      const bhB = this.dv.getUint16(dataOffB + CEREAL_ENTITY_OFFSETS.h, true);

      if (ax1 <= bx1 + bwB && ax2 >= bx1 && ay1 <= by1 + bhB && ay2 >= by1) {
        // Reconstruct Collision Entity for the callback
        this._collisionEntity.index = dataOffB;
        this._collisionEntity.id = this.dv.getUint32(
          blockIdxB * BYTES_PER_BLOCK + CEREAL_HEADER_OFFSETS.id,
          true,
        );

        callback(entity, this._collisionEntity);
      }
    }
  }

  worldLoop() {
    const totalBlocks = this.freeIndex / BYTES_PER_BLOCK;

    for (let i = totalBlocks - 1; i >= 0; i--) {
      const blockIdx = this.rankToIndex[i];
      const dataIndex = blockIdx * BYTES_PER_BLOCK + BYTES_PER_HEADER;
      const entity = this._worldLoopEntity;
      entity.index = dataIndex;
      entity.id = this.dv.getUint32(
        blockIdx * BYTES_PER_BLOCK + CEREAL_HEADER_OFFSETS.id,
        true,
      );

      movement(entity);
      this.getCollisions(i, entity, collide);
    }

    if (!this.isSorting) this.sort();
  }

  query(x1, y1, x2, y2, callback) {
    if (this.freeIndex === 0) return;

    x1 = x1 < 0 ? 0 : x1 > 65535 ? 65535 : x1 | 0;
    y1 = y1 < 0 ? 0 : y1 > 65535 ? 65535 : y1 | 0;
    x2 = x2 < 0 ? 0 : x2 > 65535 ? 65535 : x2 | 0;
    y2 = y2 < 0 ? 0 : y2 > 65535 ? 65535 : y2 | 0;

    const kMin = (MORTON_LUT[x1] | (MORTON_LUT[y1] << 1)) >>> 0;
    const kMax = (MORTON_LUT[x2] | (MORTON_LUT[y2] << 1)) >>> 0;
    const totalBlocks = this.freeIndex / BYTES_PER_BLOCK;

    let startRank = totalBlocks;
    let low = 0;
    let high = totalBlocks - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (this.mortonKeys[mid] >= kMin) {
        startRank = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    for (let i = startRank; i < totalBlocks; i++) {
      if (this.mortonKeys[i] > kMax) break;

      const blockIdx = this.rankToIndex[i];
      const bOffset = blockIdx * BYTES_PER_BLOCK + BYTES_PER_HEADER;

      const bx1 = this.dv.getUint16(bOffset + CEREAL_ENTITY_OFFSETS.px);
      const by1 = this.dv.getUint16(bOffset + CEREAL_ENTITY_OFFSETS.py);
      const bw = this.dv.getUint16(bOffset + CEREAL_ENTITY_OFFSETS.w);
      const bh = this.dv.getUint16(bOffset + CEREAL_ENTITY_OFFSETS.h);

      if (x1 <= bx1 + bw && x2 >= bx1 && y1 <= by1 + bh && y2 >= by1) {
        this._queryEntity.index = bOffset;
        this._queryEntity.id = this.dv.getUint32(
          blockIdx * BYTES_PER_BLOCK + CEREAL_HEADER_OFFSETS.id,
        );
        if (callback(this._queryEntity)) return;
      }
    }
  }
}

function movement(entity) {
  if (entity.vx === 0 && entity.vy === 0) return;
  entity.px += entity.vx;
  entity.py += entity.vy;
  entity.vx *= 0.8;
  entity.vy *= 0.8;
}
function collide(entityA, entityB) {
  const widthA = entityA.w;
  const widthB = entityB.w;
  const posXA = entityA.px;
  const posXB = entityB.px;
  const deltaX = posXA + widthA * 0.5 - (posXB + widthB * 0.5);
  const overlapX = (widthA + widthB) * 0.5 - Math.abs(deltaX);
  if (overlapX <= 0) return;

  const heightA = entityA.h;
  const heightB = entityB.h;
  const posYA = entityA.py;
  const posYB = entityB.py;
  const deltaY = posYA + heightA * 0.5 - (posYB + heightB * 0.5);
  const overlapY = (heightA + heightB) * 0.5 - Math.abs(deltaY);
  if (overlapY <= 0) return;

  const entropy = entityA.id + entityB.id + entityA.index;
  const flip = (entropy & 1) === 0;

  if (overlapX < overlapY) {
    const dirX = deltaX !== 0 ? (deltaX > 0 ? 1 : -1) : flip ? 1 : -1;
    const impulse = (overlapX * 0.5 + 1) * dirX;

    entityA.vx += impulse;
    entityB.vx -= impulse;
  } else {
    const dirY = deltaY !== 0 ? (deltaY > 0 ? 1 : -1) : flip ? 1 : -1;
    const impulse = (overlapY * 0.5 + 1) * dirY;

    entityA.vy += impulse;
    entityB.vy -= impulse;
  }
}

const MORTON_LUT = new Uint32Array(65536);
for (let i = 0; i < 65536; i++) {
  let x = i;
  x = (x | (x << 8)) & 0x00ff00ff;
  x = (x | (x << 4)) & 0x0f0f0f0f;
  x = (x | (x << 2)) & 0x33333333;
  x = (x | (x << 1)) & 0x55555555;
  MORTON_LUT[i] = x;
}

// Util
function parseOffsets(obj) {
  const newObj = {};
  let bytes = 0;
  for (let key in obj) {
    newObj[key] = bytes;
    bytes += obj[key];
  }
  newObj._totalBytes = bytes;
  return newObj;
}

export { CerealEntity, CerealSpace };
