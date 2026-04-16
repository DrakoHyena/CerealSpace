const CERAL_ENTITY_OFFSETS = {
  px: 0, // 2
  py: 2, // 2
  vx: 4, // 4
  vy: 8, // 4
  w: 12, // 2
  h: 14, // 2
};
const BYTES_PER_ENTITY = 16;

const CERAL_HEADER_OFFSETS = {
  id: 0,
};
const BYTES_PER_HEADER = 4;
const BYTES_PER_BLOCK = BYTES_PER_ENTITY + BYTES_PER_HEADER;

const MORTON_LUT = new Uint32Array(65536);
for (let i = 0; i < 65536; i++) {
  let x = i;
  x = (x | (x << 8)) & 0x00ff00ff;
  x = (x | (x << 4)) & 0x0f0f0f0f;
  x = (x | (x << 2)) & 0x33333333;
  x = (x | (x << 1)) & 0x55555555;
  MORTON_LUT[i] = x;
}

class CerealEntity {
  constructor(cerealSpace, index) {
    this.cs = cerealSpace;
    this.id = this.cs.dv.getUint32(
      index - BYTES_PER_HEADER + CERAL_HEADER_OFFSETS.id,
    );
    this.index = index;
  }

  sync() {
    this.index = this.cs.idToDataIndex[this.id];
  }

  get px() {
    return this.cs.dv.getUint16(this.index + CERAL_ENTITY_OFFSETS.px);
  }
  set px(v) {
    this.cs.dv.setUint16(this.index + CERAL_ENTITY_OFFSETS.px, v);
  }

  get py() {
    return this.cs.dv.getUint16(this.index + CERAL_ENTITY_OFFSETS.py);
  }
  set py(v) {
    this.cs.dv.setUint16(this.index + CERAL_ENTITY_OFFSETS.py, v);
  }

  get vx() {
    return this.cs.dv.getInt32(this.index + CERAL_ENTITY_OFFSETS.vx);
  }
  set vx(v) {
    this.cs.dv.setInt32(this.index + CERAL_ENTITY_OFFSETS.vx, v);
  }

  get vy() {
    return this.cs.dv.getInt32(this.index + CERAL_ENTITY_OFFSETS.vy);
  }
  set vy(v) {
    this.cs.dv.setInt32(this.index + CERAL_ENTITY_OFFSETS.vy, v);
  }

  get w() {
    return this.cs.dv.getUint16(this.index + CERAL_ENTITY_OFFSETS.w);
  }
  set w(v) {
    this.cs.dv.setUint16(this.index + CERAL_ENTITY_OFFSETS.w, v);
  }

  get h() {
    return this.cs.dv.getUint16(this.index + CERAL_ENTITY_OFFSETS.h);
  }
  set h(v) {
    this.cs.dv.setUint16(this.index + CERAL_ENTITY_OFFSETS.h, v);
  }
}

class CerealSpace {
  constructor() {
    this.maxEntities = 0x1000000;

    this.bufA = new ArrayBuffer(this.maxEntities * BYTES_PER_BLOCK);
    this.dvA = new DataView(this.bufA);
    this.u8A = new Uint8Array(this.bufA);
    this.bufB = new ArrayBuffer(this.maxEntities * BYTES_PER_BLOCK);
    this.dvB = new DataView(this.bufB);
    this.u8B = new Uint8Array(this.bufB);

    this.dv = this.dvA;
    this.u8 = this.u8A;
    this.radixDv = this.dvB;
    this.radixU8 = this.u8B;

    this.radixCounts = new Uint32Array(0x10000);
    this.radixOffsets = new Uint32Array(0x10000);

    this.mortonKeys = new Uint32Array(this.maxEntities);
    this.blockToIndex = new Uint32Array(this.maxEntities);
    this.blockToIndexTemp = new Uint32Array(this.maxEntities);

    this.freeIndex = 0;
    this.nextEntryId = 1;
    this.idToDataIndex = new Uint32Array(this.maxEntities);

    this._loopEntity = new CerealEntity(this, BYTES_PER_HEADER);
    this._collisionEntity = new CerealEntity(this, BYTES_PER_HEADER);
  }

  addEntity() {
    const blockStart = this.freeIndex;
    this.dv.setUint32(blockStart + CERAL_HEADER_OFFSETS.id, this.nextEntryId++);
    this.freeIndex += BYTES_PER_BLOCK;
    const dataIndex = blockStart + BYTES_PER_HEADER;
    this.idToDataIndex[this.nextEntryId - 1] = dataIndex;
    return dataIndex;
  }

  deleteEntity(dataIndex) {
    const blockStart = dataIndex - BYTES_PER_HEADER;
    const lastBlockStart = this.freeIndex - BYTES_PER_BLOCK;

    if (blockStart !== lastBlockStart) {
      this.u8.copyWithin(blockStart, lastBlockStart, this.freeIndex);
      this.idToDataIndex[
        this.dv.getUint32(blockStart + CERAL_HEADER_OFFSETS.id)
      ] = blockStart + BYTES_PER_HEADER;
    }

    this.freeIndex -= BYTES_PER_BLOCK;
  }

  sort() {
    if (this.freeIndex <= BYTES_PER_BLOCK * 2) return;
    const blockCount = this.freeIndex / BYTES_PER_BLOCK;
    for (let i = 0; i < blockCount; i++) {
      const dataIndex = i * BYTES_PER_BLOCK + BYTES_PER_HEADER;
      const px = this.dv.getUint16(dataIndex + CERAL_ENTITY_OFFSETS.px);
      const py = this.dv.getUint16(dataIndex + CERAL_ENTITY_OFFSETS.py);
      const key = (MORTON_LUT[px] | (MORTON_LUT[py] << 1)) >>> 0;
      this.mortonKeys[i] = key;
      this.blockToIndex[i] = i;
    }
    this._radixPass(0, this.blockToIndex, this.blockToIndexTemp);
    this._radixPass(16, this.blockToIndexTemp, this.blockToIndex);
    for (let i = 0; i < blockCount; i++) {
      const oldEntityIndex = this.blockToIndex[i] * BYTES_PER_BLOCK;
      const newEntityIndex = i * BYTES_PER_BLOCK;
      let j = 0;
      for (; j <= BYTES_PER_BLOCK - 4; j += 4) {
        this.radixDv.setUint32(
          newEntityIndex + j,
          this.dv.getUint32(oldEntityIndex + j),
        );
      }
      for (; j < BYTES_PER_BLOCK; j++) {
        this.radixDv.setUint8(
          newEntityIndex + j,
          this.dv.getUint8(oldEntityIndex + j),
        );
      }
      this.idToDataIndex[
        this.dv.getUint32(oldEntityIndex + CERAL_HEADER_OFFSETS.id)
      ] = newEntityIndex + BYTES_PER_HEADER;
    }

    const swapU8 = this.u8;
    const swapDv = this.dv;
    this.u8 = this.radixU8;
    this.dv = this.radixDv;
    this.radixU8 = swapU8;
    this.radixDv = swapDv;
  }
  _radixPass(bitShift, srcIndices, destIndices) {
    const blockCount = this.freeIndex / BYTES_PER_BLOCK;
    const counts = this.radixCounts;
    const offsets = this.radixOffsets;
    const keys = this.mortonKeys; // Local reference is faster

    counts.fill(0);
    for (let i = 0; i < blockCount; i++) {
      counts[(keys[srcIndices[i]] >>> bitShift) & 0xffff]++;
    }

    let totalOffset = 0;
    for (let i = 0; i < 0x10000; i++) {
      offsets[i] = totalOffset;
      totalOffset += counts[i];
    }

    for (let i = 0; i < blockCount; i++) {
      const val = srcIndices[i];
      const digit = (keys[val] >>> bitShift) & 0xffff;
      destIndices[offsets[digit]++] = val;
    }
  }
  getCollisions(entity, callback) {
    const aBlockIdx = (entity.index - BYTES_PER_HEADER) / BYTES_PER_BLOCK;

    // Cache frequently used values
    const dv = this.dv;
    const aDataOffset = entity.index;

    const ax1 = dv.getUint16(aDataOffset + CERAL_ENTITY_OFFSETS.px);
    const ay1 = dv.getUint16(aDataOffset + CERAL_ENTITY_OFFSETS.py);
    const ax2 = ax1 + dv.getUint16(aDataOffset + CERAL_ENTITY_OFFSETS.w);
    const ay2 = ay1 + dv.getUint16(aDataOffset + CERAL_ENTITY_OFFSETS.h);

    // Morton Cutoff logic
    const keyCutoff =
      (MORTON_LUT[(ax2 | -(ay2 >> 16)) & 0xffff] |
        (MORTON_LUT[(ay2 | -(ay2 >> 16)) & 0xffff] << 1)) >>>
      0;

    const maxItrs = 2046;
    const startBlock = aBlockIdx + 1;
    const totalBlocks = this.freeIndex / BYTES_PER_BLOCK;
    const endBlock = Math.min(totalBlocks, startBlock + maxItrs);

    for (let b = startBlock; b < endBlock; b++) {
      const bKey = this.mortonKeys[b];
      if (bKey > keyCutoff) break;

      const bBlockOffset = b * BYTES_PER_BLOCK;
      const bDataOffset = bBlockOffset + BYTES_PER_HEADER;

      const bx1 = dv.getUint16(bDataOffset + CERAL_ENTITY_OFFSETS.px);
      const by1 = dv.getUint16(bDataOffset + CERAL_ENTITY_OFFSETS.py);
      const bx2 = bx1 + dv.getUint16(bDataOffset + CERAL_ENTITY_OFFSETS.w);
      const by2 = by1 + dv.getUint16(bDataOffset + CERAL_ENTITY_OFFSETS.h);

      if (ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1) {
        this._collisionEntity.index = bDataOffset;
        this._collisionEntity.id = dv.getUint32(
          bBlockOffset + CERAL_HEADER_OFFSETS.id,
        );
        callback(entity, this._collisionEntity);
      }
    }
  }

  loopEntities(cb) {
    for (let i = 0; i < this.freeIndex; i += BYTES_PER_BLOCK) {
      this._loopEntity.id = this.dv.getUint32(i + CERAL_HEADER_OFFSETS.id);
      this._loopEntity.index = i + BYTES_PER_HEADER;
      cb(this._loopEntity);
    }
  }

  worldLoop() {
    this.loopEntities((entity) => {
      movement(entity);
      this.getCollisions(entity, collide);
    });
    this.sort();
  }
}

function movement(entity) {
  entity.px += entity.vx;
  entity.py += entity.vy;
  entity.vx *= 0.9;
  entity.vy *= 0.9;
}

// ai slop because idc about this for now
function collide(a, b) {
  // 1. Calculate Distances & Overlap
  const dx = a.px + a.w / 2 - (b.px + b.w / 2);
  const dy = a.py + a.h / 2 - (b.py + b.h / 2);

  const ox = (a.w + b.w) / 2 - Math.abs(dx);
  if (ox <= 0) return; // Early exit X

  const oy = (a.h + b.h) / 2 - Math.abs(dy);
  if (oy <= 0) return; // Early exit Y

  // 2. Calculate simple mass ratio (Area)
  const m1 = a.w * a.h;
  const m2 = b.w * b.h;
  const r1 = m2 / (m1 + m2);
  const r2 = 1 - r1;

  // 3. Resolve on the shallowest axis
  if (ox < oy) {
    const dir = Math.sign(dx) || (Math.random() < 0.5 ? 1 : -1);

    // Stochastic Rounding applied to cleanly cast to Int without drift bias
    a.px += Math.floor(ox * r1 * dir + Math.random());
    b.px -= Math.floor(ox * r2 * dir + Math.random());
    a.vx += Math.floor(r1 * dir * 2 + Math.random()); // Impulse
    b.vx -= Math.floor(r2 * dir * 2 + Math.random());
  } else {
    const dir = Math.sign(dy) || (Math.random() < 0.5 ? 1 : -1);

    // Stochastic Rounding applied to cleanly cast to Int without drift bias
    a.py += Math.floor(oy * r1 * dir + Math.random());
    b.py -= Math.floor(oy * r2 * dir + Math.random());
    a.vy += Math.floor(r1 * dir * 2 + Math.random()); // Impulse
    b.vy -= Math.floor(r2 * dir * 2 + Math.random());
  }
}

export { CerealEntity, CerealSpace };
