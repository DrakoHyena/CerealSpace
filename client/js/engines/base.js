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
    );
    this.index = index;
  }

  sync() {
    this.index = this.cs.idToDataIndex[this.id];
  }

  get px() {
    return this.cs.dv.getUint16(this.index + CEREAL_ENTITY_OFFSETS.px);
  }
  set px(v) {
    this.cs.dv.setUint16(this.index + CEREAL_ENTITY_OFFSETS.px, v);
  }

  get py() {
    return this.cs.dv.getUint16(this.index + CEREAL_ENTITY_OFFSETS.py);
  }
  set py(v) {
    this.cs.dv.setUint16(this.index + CEREAL_ENTITY_OFFSETS.py, v);
  }

  get vx() {
    return this.cs.dv.getInt32(this.index + CEREAL_ENTITY_OFFSETS.vx);
  }
  set vx(v) {
    this.cs.dv.setInt32(this.index + CEREAL_ENTITY_OFFSETS.vx, v);
  }

  get vy() {
    return this.cs.dv.getInt32(this.index + CEREAL_ENTITY_OFFSETS.vy);
  }
  set vy(v) {
    this.cs.dv.setInt32(this.index + CEREAL_ENTITY_OFFSETS.vy, v);
  }

  get w() {
    return this.cs.dv.getUint16(this.index + CEREAL_ENTITY_OFFSETS.w);
  }
  set w(v) {
    this.cs.dv.setUint16(this.index + CEREAL_ENTITY_OFFSETS.w, v);
  }

  get h() {
    return this.cs.dv.getUint16(this.index + CEREAL_ENTITY_OFFSETS.h);
  }
  set h(v) {
    this.cs.dv.setUint16(this.index + CEREAL_ENTITY_OFFSETS.h, v);
  }
}

class CerealSpace {
  constructor() {
    this.maxEntities = 0x100000 >> 1;
    this.maxEntitiesBytes = this.maxEntities * BYTES_PER_BLOCK;

    this.buf = new ArrayBuffer(this.maxEntitiesBytes * 2);
    this.memory = new Uint8Array(this.buf);

    this.dvA = new DataView(this.buf, 0, this.maxEntitiesBytes);
    this.u8A = new Uint8Array(this.buf, 0, this.maxEntitiesBytes);
    this.dvB = new DataView(
      this.buf,
      this.maxEntitiesBytes,
      this.maxEntitiesBytes,
    );
    this.u8B = new Uint8Array(
      this.buf,
      this.maxEntitiesBytes,
      this.maxEntitiesBytes,
    );

    this.activeBuffer = 0;
    this.dv = this.dvA;
    this.u8 = this.u8A;

    this.radixCounts0 = new Uint32Array(0x10000);
    this.radixCounts1 = new Uint32Array(0x10000);
    this.radixOffsets0 = new Uint32Array(0x10000);
    this.radixOffsets1 = new Uint32Array(0x10000);

    this.mortonKeys = new Uint32Array(this.maxEntities);
    this.mortonKeysTemp = new Uint32Array(this.maxEntities);
    this.blockToIndex = new Uint32Array(this.maxEntities);
    this.blockToIndexTemp = new Uint32Array(this.maxEntities);

    this.idToDataIndex = new Uint32Array(this.maxEntities);
    this.freeIds = new Uint32Array(this.maxEntities);
    for (let i = 0; i < this.maxEntities; i++) {
      this.freeIds[i] = i + 1;
    }
    this.lastFreeId = this.maxEntities - 1;

    this.freeIndex = 0;

    this._loopEntity = new CerealEntity(this, BYTES_PER_HEADER);
    this._collisionEntity = new CerealEntity(this, BYTES_PER_HEADER);
    this._queryEntity = new CerealEntity(this, BYTES_PER_HEADER);
  }

  addEntity() {
    const blockStart = this.freeIndex;
    this.u8.fill(0, blockStart, blockStart + BYTES_PER_BLOCK);
    const id = this.freeIds[this.lastFreeId--];
    this.dv.setUint32(blockStart + CEREAL_HEADER_OFFSETS.id, id);
    const dataIndex = blockStart + BYTES_PER_HEADER;
    this.idToDataIndex[id] = dataIndex;
    this.freeIndex += BYTES_PER_BLOCK;
    return dataIndex;
  }

  deleteEntity(dataIndex) {
    const blockStart = dataIndex - BYTES_PER_HEADER;
    const lastBlockStart = this.freeIndex - BYTES_PER_BLOCK;

    this.lastFreeId++;
    this.freeIds[this.lastFreeId] = this.dv.getUint32(
      blockStart + CEREAL_HEADER_OFFSETS.id,
    );

    if (blockStart !== lastBlockStart) {
      this.u8.copyWithin(blockStart, lastBlockStart, this.freeIndex);
      this.idToDataIndex[
        this.dv.getUint32(blockStart + CEREAL_HEADER_OFFSETS.id)
      ] = blockStart + BYTES_PER_HEADER;
    }

    this.freeIndex -= BYTES_PER_BLOCK;
  }

  sort() {
    if (this.freeIndex <= BYTES_PER_BLOCK * 2) return;
    const blockCount = this.freeIndex / BYTES_PER_BLOCK;

    const keys = this.mortonKeys;
    const keysTemp = this.mortonKeysTemp;
    const indicesSrc = this.blockToIndex;
    const indicesTemp = this.blockToIndexTemp;

    const counts0 = this.radixCounts0;
    const counts1 = this.radixCounts1;
    counts0.fill(0);
    counts1.fill(0);

    // get keys, indices, and counts
    for (let i = 0; i < blockCount; i++) {
      const dataIndex = i * BYTES_PER_BLOCK + BYTES_PER_HEADER;
      const px = this.dv.getUint16(dataIndex + CEREAL_ENTITY_OFFSETS.px);
      const py = this.dv.getUint16(dataIndex + CEREAL_ENTITY_OFFSETS.py);

      const key = (MORTON_LUT[px] | (MORTON_LUT[py] << 1)) >>> 0;
      keys[i] = key;
      indicesSrc[i] = i;

      counts0[key & 0xffff]++;
      counts1[(key >>> 16) & 0xffff]++;
    }

    // calculate offsets
    const offsets0 = this.radixOffsets0;
    const offsets1 = this.radixOffsets1;
    let total0 = 0;
    let total1 = 0;
    for (let i = 0; i < 0x10000; i++) {
      offsets0[i] = total0;
      total0 += counts0[i];

      offsets1[i] = total1;
      total1 += counts1[i];
    }

    // sort first u16
    for (let i = 0; i < blockCount; i++) {
      const val = indicesSrc[i];
      const digit = keys[val] & 0xffff;
      indicesTemp[offsets0[digit]++] = val;
    }

    // sort second u16 and copy over
    const activeOffset = this.activeBuffer === 0 ? 0 : this.maxEntitiesBytes;
    const inactiveOffset = this.activeBuffer === 0 ? this.maxEntitiesBytes : 0;

    for (let i = 0; i < blockCount; i++) {
      const val = indicesTemp[i];
      const key = keys[val];
      const digit = (key >>> 16) & 0xffff;

      const sortedRank = offsets1[digit]++;

      const oldEntityIndex = val * BYTES_PER_BLOCK;
      const newEntityIndex = sortedRank * BYTES_PER_BLOCK;

      this.memory.copyWithin(
        inactiveOffset + newEntityIndex,
        activeOffset + oldEntityIndex,
        activeOffset + oldEntityIndex + BYTES_PER_BLOCK,
      );

      keysTemp[sortedRank] = key;

      this.idToDataIndex[
        this.dv.getUint32(oldEntityIndex + CEREAL_HEADER_OFFSETS.id)
      ] = newEntityIndex + BYTES_PER_HEADER;
    }

    this.activeBuffer = this.activeBuffer === 0 ? 1 : 0;
    this.dv = this.activeBuffer === 0 ? this.dvA : this.dvB;
    this.u8 = this.activeBuffer === 0 ? this.u8A : this.u8B;
    this.mortonKeys = keysTemp;
    this.mortonKeysTemp = keys;
  }

  query(x1, y1, x2, y2, callback, minIndex = 0) {
    if (this.freeIndex === 0) return;

    x1 = x1 < 0 ? 0 : x1 > 65535 ? 65535 : x1 | 0;
    y1 = y1 < 0 ? 0 : y1 > 65535 ? 65535 : y1 | 0;
    x2 = x2 < 0 ? 0 : x2 > 65535 ? 65535 : x2 | 0;
    y2 = y2 < 0 ? 0 : y2 > 65535 ? 65535 : y2 | 0;

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

      const bBlockOffset = b * BYTES_PER_BLOCK;
      const bDataOffset = bBlockOffset + BYTES_PER_HEADER;

      const bx1 = this.dv.getUint16(bDataOffset + CEREAL_ENTITY_OFFSETS.px);
      const by1 = this.dv.getUint16(bDataOffset + CEREAL_ENTITY_OFFSETS.py);
      const bx2 =
        bx1 + this.dv.getUint16(bDataOffset + CEREAL_ENTITY_OFFSETS.w);
      const by2 =
        by1 + this.dv.getUint16(bDataOffset + CEREAL_ENTITY_OFFSETS.h);

      if (x1 <= bx2 && x2 >= bx1 && y1 <= by2 && y2 >= by1) {
        this._queryEntity.index = bDataOffset;
        this._queryEntity.id = this.dv.getUint32(
          bBlockOffset + CEREAL_HEADER_OFFSETS.id,
        );

        if (callback(this._queryEntity)) {
          return;
        }
      }
    }
  }

  getCollisions(entity, callback) {
    const aBlockIdx = (entity.index - BYTES_PER_HEADER) / BYTES_PER_BLOCK;

    const dv = this.dv;
    const aDataOffset = entity.index;

    const ax1 = dv.getUint16(aDataOffset + CEREAL_ENTITY_OFFSETS.px);
    const ay1 = dv.getUint16(aDataOffset + CEREAL_ENTITY_OFFSETS.py);
    const ax2 = ax1 + dv.getUint16(aDataOffset + CEREAL_ENTITY_OFFSETS.w);
    const ay2 = ay1 + dv.getUint16(aDataOffset + CEREAL_ENTITY_OFFSETS.h);

    const keyCutoff =
      (MORTON_LUT[ax2 & 0xffff] | (MORTON_LUT[ay2 & 0xffff] << 1)) >>> 0;

    const maxItrs = Infinity;
    const startBlock = aBlockIdx + 1;
    const totalBlocks = this.freeIndex / BYTES_PER_BLOCK;
    const endBlock = Math.min(totalBlocks, startBlock + maxItrs);

    for (let b = startBlock; b < endBlock; b++) {
      const bKey = this.mortonKeys[b];
      if (bKey > keyCutoff) break;

      const bBlockOffset = b * BYTES_PER_BLOCK;
      const bDataOffset = bBlockOffset + BYTES_PER_HEADER;

      const bx1 = dv.getUint16(bDataOffset + CEREAL_ENTITY_OFFSETS.px);
      const by1 = dv.getUint16(bDataOffset + CEREAL_ENTITY_OFFSETS.py);
      const bx2 = bx1 + dv.getUint16(bDataOffset + CEREAL_ENTITY_OFFSETS.w);
      const by2 = by1 + dv.getUint16(bDataOffset + CEREAL_ENTITY_OFFSETS.h);

      if (ax1 <= bx2 && ax2 >= bx1 && ay1 <= by2 && ay2 >= by1) {
        this._collisionEntity.index = bDataOffset;
        this._collisionEntity.id = dv.getUint32(
          bBlockOffset + CEREAL_HEADER_OFFSETS.id,
        );
        callback(entity, this._collisionEntity);
      }
    }
  }

  loopEntities(cb) {
    for (
      let i = this.freeIndex - BYTES_PER_BLOCK;
      i >= 0;
      i -= BYTES_PER_BLOCK
    ) {
      this._loopEntity.id = this.dv.getUint32(i + CEREAL_HEADER_OFFSETS.id);
      this._loopEntity.index = i + BYTES_PER_HEADER;
      cb(this._loopEntity);
    }
  }

  worldLoop() {
    this.loopEntities((entity) => {
      // Movement
      movement(entity);
      // Collision
      this.getCollisions(entity, collide);
    });
    this.sort();
  }
}

function movement(entity) {
  if (entity.vx === 0 && entity.vy === 0) return;
  entity.px += entity.vx;
  entity.py += entity.vy;
  entity.vx *= 0.8;
  entity.vy *= 0.8;
}
function collide(entityA, entityB, damper = 1) {
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
    const directionY = centerDistanceY >= 0 ? -1 : -1;
    const impulseY = overlapY * 0.5 * directionY;
    entityA.vy += Math.round(impulseY * damper);
    entityB.vy -= Math.round(impulseY * damper);
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
