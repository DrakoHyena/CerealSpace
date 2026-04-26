import { CONFIG } from "/js/configs/base.js";
import {
  CerealEntity,
  CEREAL_HEADER_OFFSETS,
  CEREAL_ENTITY_OFFSETS,
  CEREAL_U32_HEADER_OFFSETS,
  CEREAL_U32_ENTITY_OFFSETS,
  BYTES_PER_BLOCK,
  BYTES_PER_HEADER,
  BYTES_PER_ENTITY,
  u32_PER_BLOCK,
  U32_PER_HEADER,
  u32_PER_ENTITY,
} from "/js/entities/base.js";

function tickCerealSpace(cs) {
  cs.loopEntities((entity) => {
    // Movement
    movement(entity);
    // Collision
    if (cs.tick % CONFIG.CerealSpace.collisionInterval === 0)
      cs.getCollisions(entity, collide);
  });
  if (cs.tick % CONFIG.CerealSpace.sortInterval === 0) cs.sort();
  cs.tick++;
}

function movement(entity) {
  if (entity.vx === 0 && entity.vy === 0) return;
  entity.px += entity.vx;
  entity.py += entity.vy;
  entity.vx *= 0.8;
  entity.vy *= 0.8;
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

class CerealSpace {
  constructor() {
    this.maxEntities = CONFIG.CerealSpace.maxEntities;
    this.maxEntitiesBytes = this.maxEntities * BYTES_PER_BLOCK;

    this.entityBuf = new SharedArrayBuffer(this.maxEntitiesBytes * 2);
    this.entityU8 = new Uint8Array(this.entityBuf);

    this.dvA = new DataView(this.entityBuf, 0, this.maxEntitiesBytes);
    this.dvB = new DataView(
      this.entityBuf,
      this.maxEntitiesBytes,
      this.maxEntitiesBytes,
    );
    this.u8A = new Uint8Array(this.entityBuf, 0, this.maxEntitiesBytes);
    this.u8B = new Uint8Array(
      this.entityBuf,
      this.maxEntitiesBytes,
      this.maxEntitiesBytes,
    );
    this.u32A = new Uint32Array(this.entityBuf, 0, this.maxEntitiesBytes / 4);
    this.u32B = new Uint32Array(
      this.entityBuf,
      this.maxEntitiesBytes,
      this.maxEntitiesBytes / 4,
    );
    this.i32A = new Int32Array(this.entityBuf, 0, this.maxEntitiesBytes / 4);
    this.i32B = new Int32Array(
      this.entityBuf,
      this.maxEntitiesBytes,
      this.maxEntitiesBytes / 4,
    );

    this.dv = this.dvA;
    this.u8 = this.u8A;
    this.u32 = this.u32A;
    this.i32 = this.i32A;
    this._activeSide = 0;

    this.mortonKeysA = new Uint32Array(this.maxEntities);
    this.mortonKeysB = new Uint32Array(this.maxEntities);
    this.mortonKeys = this.mortonKeysA;
    this.tempIndices = new Uint32Array(this.maxEntities);
    this.radixCounts0 = new Uint32Array(0x10000);
    this.radixCounts1 = new Uint32Array(0x10000);

    this.idToDataIndex = new Uint32Array(this.maxEntities + 1);
    this.freeIds = new Uint32Array(this.maxEntities);
    for (let i = 0; i < this.maxEntities; i++) {
      this.freeIds[i] = i + 1;
    }
    this.nextFreeId = this.maxEntities - 1;
    this.freeIdSpace = this.maxEntities;

    this.freeIndex = 0;

    this._loopEntity = new CerealEntity(this, BYTES_PER_HEADER);
    this._collisionEntity = new CerealEntity(this, BYTES_PER_HEADER);
    this._queryEntity = new CerealEntity(this, BYTES_PER_HEADER);
    this.tick = 0;
  }

  addEntity() {
    if (this.freeIndex === this.maxEntitiesBytes)
      throw new Error(
        `Cannot create entities past the maximum of ${this.maxEntities}`,
      );
    this.u8.fill(0, this.freeIndex, this.freeIndex + BYTES_PER_BLOCK);
    const id = this.getNewId();
    this.u32[(this.freeIndex >> 2) + CEREAL_U32_HEADER_OFFSETS.id] = id;
    this.idToDataIndex[id] = this.freeIndex + BYTES_PER_HEADER;
    this.freeIndex += BYTES_PER_BLOCK;
    return this.freeIndex - BYTES_PER_ENTITY;
  }

  deleteEntity(dataIndex) {
    const blockStart = dataIndex - BYTES_PER_HEADER;
    const u32BlockStart = blockStart >> 2;
    const lastBlockStart = this.freeIndex - BYTES_PER_BLOCK;

    this.recycleOldId(this.u32[u32BlockStart + CEREAL_U32_HEADER_OFFSETS.id]);

    if (blockStart !== lastBlockStart) {
      this.u8.copyWithin(blockStart, lastBlockStart, this.freeIndex);
      this.idToDataIndex[
        this.u32[u32BlockStart + CEREAL_U32_HEADER_OFFSETS.id]
      ] = blockStart + BYTES_PER_HEADER;
      this.u32[u32BlockStart + CEREAL_U32_HEADER_OFFSETS.id] = 0;
    }

    this.freeIndex -= BYTES_PER_BLOCK;
  }

  loopEntities(cb) {
    for (let i = this.freeIndex / BYTES_PER_BLOCK - 1; i >= 0; i--) {
      this._loopEntity.id =
        this.u32[i * u32_PER_BLOCK + CEREAL_U32_HEADER_OFFSETS.id];
      this._loopEntity.index = i * BYTES_PER_BLOCK + BYTES_PER_HEADER;
      cb(this._loopEntity);
    }
  }

  _swapSides() {
    if (this._activeSide === 0) {
      this.dv = this.dvB;
      this.u8 = this.u8B;
      this.u32 = this.u32B;
      this.i32 = this.i32B;
      this.mortonKeys = this.mortonKeysB;
      this._activeSide = 1;
    } else {
      this.dv = this.dvA;
      this.u8 = this.u8A;
      this.u32 = this.u32A;
      this.i32 = this.i32A;
      this.mortonKeys = this.mortonKeysA;
      this._activeSide = 0;
    }
  }

  sort() {
    if (this.freeIndex <= BYTES_PER_BLOCK * 2) return;
    const blockCount = this.freeIndex / BYTES_PER_BLOCK;

    const readKeys = this.mortonKeys;
    const writeKeys =
      this._activeSide === 0 ? this.mortonKeysB : this.mortonKeysA;
    const indicesTemp = this.tempIndices;
    const counts0 = this.radixCounts0;
    const counts1 = this.radixCounts1;
    counts0.fill(0);
    counts1.fill(0);

    // get keys, indices, and counts
    for (let i = 0; i < blockCount; i++) {
      const pos =
        this.u32[
          i * u32_PER_BLOCK + U32_PER_HEADER + CEREAL_U32_ENTITY_OFFSETS.px
        ];
      const px = pos & 0xffff;
      const py = pos >>> 16;
      const key = (MORTON_LUT[px] | (MORTON_LUT[py] << 1)) >>> 0;
      readKeys[i] = key;
      counts0[key & 0xffff]++;
      counts1[(key >>> 16) & 0xffff]++;
    }

    // calculate offsets
    let total0 = 0;
    let total1 = 0;
    for (let i = 0; i < 0x10000; i++) {
      const old0 = counts0[i];
      const old1 = counts1[i];
      counts0[i] = total0;
      counts1[i] = total1;
      total0 += old0;
      total1 += old1;
    }

    // sort first u16
    for (let i = 0; i < blockCount; i++) {
      indicesTemp[counts0[readKeys[i] & 0xffff]++] = i;
    }

    // sort second u16 and copy over
    const activeOffset = this._activeSide === 0 ? 0 : this.maxEntitiesBytes;
    const inactiveOffset = this._activeSide === 0 ? this.maxEntitiesBytes : 0;

    for (let i = 0; i < blockCount; i++) {
      const originalIndex = indicesTemp[i];
      const key = readKeys[originalIndex];
      const targetIndex = counts1[(key >>> 16) & 0xffff]++;

      const oldEntityIndex = originalIndex * BYTES_PER_BLOCK;
      const newEntityIndex = targetIndex * BYTES_PER_BLOCK;
      this.entityU8.copyWithin(
        inactiveOffset + newEntityIndex,
        activeOffset + oldEntityIndex,
        activeOffset + oldEntityIndex + BYTES_PER_BLOCK,
      );

      writeKeys[targetIndex] = key;

      this.idToDataIndex[
        this.u32[originalIndex * u32_PER_BLOCK + CEREAL_U32_HEADER_OFFSETS.id]
      ] = newEntityIndex + BYTES_PER_HEADER;
    }
    this._swapSides();
  }

  getCollisions(entity, callback) {
    const blockIndex = (entity.index - BYTES_PER_HEADER) / BYTES_PER_BLOCK;
    const blockA32 = blockIndex * u32_PER_BLOCK;
    const dataA32 = blockA32 + U32_PER_HEADER;

    const posA = this.u32[dataA32 + CEREAL_U32_ENTITY_OFFSETS.px];
    const ax1 = posA & 0xffff;
    const ay1 = posA >>> 16;

    const sizeA = this.u32[dataA32 + CEREAL_U32_ENTITY_OFFSETS.w];
    const ax2 = ax1 + (sizeA & 0xffff);
    const ay2 = ay1 + (sizeA >>> 16);

    const keyCutoff =
      (MORTON_LUT[ax2 & 0xffff] | (MORTON_LUT[ay2 & 0xffff] << 1)) >>> 0;

    const maxItrs = CONFIG.CerealSpace.maxCollisionLoops;
    const blockCount = this.freeIndex / BYTES_PER_BLOCK;
    const end = Math.min(blockCount, blockIndex + maxItrs);
    for (let b = blockIndex + 1; b < end; b++) {
      if (this.mortonKeys[b] > keyCutoff) break;

      const blockB32 = b * u32_PER_BLOCK;
      const dataB32 = blockB32 + U32_PER_HEADER;

      const posB = this.u32[dataB32 + CEREAL_U32_ENTITY_OFFSETS.px];
      const bx1 = posB & 0xffff;
      const by1 = posB >>> 16;

      const sizeB = this.u32[dataB32 + CEREAL_U32_ENTITY_OFFSETS.w];
      const bx2 = bx1 + (sizeB & 0xffff);
      const by2 = by1 + (sizeB >>> 16);

      if (ax1 <= bx2 && ax2 >= bx1 && ay1 <= by2 && ay2 >= by1) {
        this._collisionEntity.index = b * BYTES_PER_BLOCK + BYTES_PER_HEADER;
        this._collisionEntity.id =
          this.u32[blockB32 + CEREAL_U32_HEADER_OFFSETS.id];
        callback(entity, this._collisionEntity);
      }
    }
  }

  query(x1, y1, x2, y2, callback, minIndex = 0) {
    if (this.freeIndex === 0) return;

    x1 = Math.min(65535, Math.max(0, x1 | 0));
    y1 = Math.min(65535, Math.max(0, y1 | 0));
    x2 = Math.min(65535, Math.max(0, x2 | 0));
    y2 = Math.min(65535, Math.max(0, y2 | 0));

    const kMin =
      (MORTON_LUT[x1 & 0xffff] | (MORTON_LUT[y1 & 0xffff] << 1)) >>> 0;
    const kMax =
      (MORTON_LUT[x2 & 0xffff] | (MORTON_LUT[y2 & 0xffff] << 1)) >>> 0;

    const totalBlocks = this.freeIndex / BYTES_PER_BLOCK;

    // Find starting block
    let startBlock = totalBlocks;
    let low = minIndex;
    let high = totalBlocks - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (this.mortonKeys[mid] >= kMin) {
        startBlock = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    for (let b = startBlock; b < totalBlocks; b++) {
      const bKey = this.mortonKeys[b];
      if (bKey > kMax) break;

      const blockB32 = b * u32_PER_BLOCK;
      const dataB32 = blockB32 + U32_PER_HEADER;
      const posB = this.u32[dataB32 + CEREAL_U32_ENTITY_OFFSETS.px];
      const sizeB = this.u32[dataB32 + CEREAL_U32_ENTITY_OFFSETS.w];
      const bx1 = posB & 0xffff;
      const by1 = posB >>> 16;
      const bx2 = bx1 + (sizeB & 0xffff);
      const by2 = by1 + (sizeB >>> 16);

      if (x1 <= bx2 && x2 >= bx1 && y1 <= by2 && y2 >= by1) {
        this._queryEntity.index = b * BYTES_PER_BLOCK + BYTES_PER_HEADER;
        this._queryEntity.id =
          this.u32[blockB32 + CEREAL_U32_HEADER_OFFSETS.id];

        if (callback(this._queryEntity)) {
          return;
        }
      }
    }
  }

  getNewId() {
    if (this.nextFreeId < 0) this.nextFreeId = --this.freeIdSpace;
    return this.freeIds[this.nextFreeId--];
  }

  recycleOldId(id) {
    this.freeIds[this.freeIdSpace++] = id;
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

export { CerealSpace, tickCerealSpace };
