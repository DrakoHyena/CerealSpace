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
  sortKey: 0, // 4
  id: 4, // 4
};
const BYTES_PER_HEADER = 8;
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
    this.dv = cerealSpace.dv;
    this.id = this.dv.getUint32(
      index - BYTES_PER_HEADER + CERAL_HEADER_OFFSETS.id,
    );
    this.index = index;
  }

  sync() {
    this.index = this.cs.idToDataIndex[this.id];
  }

  get px() {
    return this.dv.getUint16(this.index + CERAL_ENTITY_OFFSETS.px);
  }
  set px(v) {
    this.dv.setUint16(this.index + CERAL_ENTITY_OFFSETS.px, v);
  }

  get py() {
    return this.dv.getUint16(this.index + CERAL_ENTITY_OFFSETS.py);
  }
  set py(v) {
    this.dv.setUint16(this.index + CERAL_ENTITY_OFFSETS.py, v);
  }

  get vx() {
    return this.dv.getInt32(this.index + CERAL_ENTITY_OFFSETS.vx);
  }
  set vx(v) {
    this.dv.setInt32(this.index + CERAL_ENTITY_OFFSETS.vx, v);
  }

  get vy() {
    return this.dv.getInt32(this.index + CERAL_ENTITY_OFFSETS.vy);
  }
  set vy(v) {
    this.dv.setInt32(this.index + CERAL_ENTITY_OFFSETS.vy, v);
  }

  get w() {
    return this.dv.getUint16(this.index + CERAL_ENTITY_OFFSETS.w);
  }
  set w(v) {
    this.dv.setUint16(this.index + CERAL_ENTITY_OFFSETS.w, v);
  }

  get h() {
    return this.dv.getUint16(this.index + CERAL_ENTITY_OFFSETS.h);
  }
  set h(v) {
    this.dv.setUint16(this.index + CERAL_ENTITY_OFFSETS.h, v);
  }
}

class CerealSpace {
  constructor() {
    this.buf = new ArrayBuffer(0x1000000); // 16MB
    this.dv = new DataView(this.buf);
    this.u8 = new Uint8Array(this.buf);

    this.radixBuf = new ArrayBuffer(0x1000000);
    this.radixDv = new DataView(this.radixBuf);
    this.radixU8 = new Uint8Array(this.radixBuf);

    this.radixCounts = new Uint32Array(0x10000);
    this.radixOffsets = new Uint32Array(0x10000);

    this.freeIndex = 0;
    this.nextEntryId = 1;
    this.idToDataIndex = new Uint32Array(0x1000000);

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

  deleteEntity(entryIndex) {
    const targetBlock = entryIndex - BYTES_PER_HEADER;
    const lastBlock = this.freeIndex - BYTES_PER_BLOCK;
    if (targetBlock < lastBlock) {
      this.u8.copyWithin(targetBlock, lastBlock, lastBlock + BYTES_PER_BLOCK);
      this.idToDataIndex[
        this.dv.getUint32(targetBlock + CERAL_HEADER_OFFSETS.id)
      ] = entryIndex;
    }
    this.freeIndex -= BYTES_PER_BLOCK;
  }

  sort() {
    if (this.freeIndex <= BYTES_PER_BLOCK * 2) return;
    // Pass 1: Lower 16 bits (px)
    this._radixPass(
      0,
      this.u8,
      this.dv,
      this.radixU8,
      this.radixDv,
      true,
      false,
    );
    // Pass 2: Upper 16 bits (py)
    this._radixPass(
      16,
      this.radixU8,
      this.radixDv,
      this.u8,
      this.dv,
      false,
      true,
    );
  }

  _radixPass(bitShift, srcU8, srcDv, destU8, destDv, setKey, updateIds) {
    this.radixCounts.fill(0);

    for (let i = 0; i < this.freeIndex; i += BYTES_PER_BLOCK) {
      let key;
      if (setKey) {
        const px = srcDv.getUint16(
          i + BYTES_PER_HEADER + CERAL_ENTITY_OFFSETS.px,
        );
        const py = srcDv.getUint16(
          i + BYTES_PER_HEADER + CERAL_ENTITY_OFFSETS.py,
        );
        key = MORTON_LUT[px] | (MORTON_LUT[py] << 1);
        srcDv.setUint32(i + CERAL_HEADER_OFFSETS.sortKey, key);
      } else {
        key = srcDv.getUint32(i + CERAL_HEADER_OFFSETS.sortKey);
      }

      const digit = (key >>> bitShift) & 0xffff;
      this.radixCounts[digit]++;
    }

    let totalOffset = 0;
    for (let i = 0; i < 0x10000; i++) {
      this.radixOffsets[i] = totalOffset;
      totalOffset += this.radixCounts[i] * BYTES_PER_BLOCK;
    }

    for (let i = 0; i < this.freeIndex; i += BYTES_PER_BLOCK) {
      const key = srcDv.getUint32(i + CERAL_HEADER_OFFSETS.sortKey);
      const digit = (key >>> bitShift) & 0xffff;
      const destIndex = this.radixOffsets[digit];

      let k = 0;
      for (; k <= BYTES_PER_BLOCK - 4; k += 4) {
        destDv.setUint32(destIndex + k, srcDv.getUint32(i + k));
      }
      for (; k < BYTES_PER_BLOCK; k++) {
        destU8[destIndex + k] = srcU8[i + k];
      }

      if (updateIds) {
        const id = srcDv.getUint32(i + CERAL_HEADER_OFFSETS.id);
        this.idToDataIndex[id] = destIndex + BYTES_PER_HEADER;
      }

      this.radixOffsets[digit] += BYTES_PER_BLOCK;
    }
  }
  getCollisions(entity, callback) {
    const aIndex = entity.index - BYTES_PER_HEADER;
    const aKey = this.dv.getUint32(aIndex + CERAL_HEADER_OFFSETS.sortKey);

    const ax1 = entity.px;
    const ay1 = entity.py;
    const ax2 = ax1 + entity.w;
    const ay2 = ay1 + entity.h;

    const maxNeighborCount = 1024;
    const keyThreshold = 0x1000; // Max spatial "jump" in the Z-order to consider

    // 1. SEARCH FORWARD (Indices > aIndex)
    let end = Math.min(
      this.freeIndex,
      aIndex + maxNeighborCount * BYTES_PER_BLOCK,
    );
    for (let i = aIndex + BYTES_PER_BLOCK; i < end; i += BYTES_PER_BLOCK) {
      const bKey = this.dv.getUint32(i + CERAL_HEADER_OFFSETS.sortKey);
      // If the Morton key is too far ahead, we've jumped quadrants
      if (bKey - aKey > keyThreshold) break;

      // Collision check
      this._collisionEntity.index = i + BYTES_PER_HEADER;
      const bx1 = this._collisionEntity.px;
      const by1 = this._collisionEntity.py;
      const bx2 = bx1 + this._collisionEntity.w;
      const by2 = by1 + this._collisionEntity.h;

      if (ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1) {
        this._collisionEntity.id = this.dv.getUint32(
          i + CERAL_HEADER_OFFSETS.id,
        );
        callback(entity, this._collisionEntity);
      }
    }

    // 2. SEARCH BACKWARD (Indices < aIndex)
    let start = Math.max(0, aIndex - maxNeighborCount * BYTES_PER_BLOCK);
    for (let i = aIndex - BYTES_PER_BLOCK; i >= start; i -= BYTES_PER_BLOCK) {
      const bKey = this.dv.getUint32(i + CERAL_HEADER_OFFSETS.sortKey);
      // If the Morton key is too far behind
      if (aKey - bKey > keyThreshold) break;

      // Collision check
      this._collisionEntity.index = i + BYTES_PER_HEADER;
      const bx1 = this._collisionEntity.px;
      const by1 = this._collisionEntity.py;
      const bx2 = bx1 + this._collisionEntity.w;
      const by2 = by1 + this._collisionEntity.h;

      if (ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1) {
        this._collisionEntity.id = this.dv.getUint32(
          i + CERAL_HEADER_OFFSETS.id,
        );
        callback(entity, this._collisionEntity);
      }
    }
  }

  _checkCollide(ax1, ay1, ax2, ay2, i, entity, callback) {
    const bx1 = this._collisionEntity.px;
    const by1 = this._collisionEntity.py;
    const bx2 = bx1 + this._collisionEntity.w;
    const by2 = by1 + this._collisionEntity.h;

    if (ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1) {
      this._collisionEntity.id = this.dv.getUint32(i + CERAL_HEADER_OFFSETS.id);
      callback(entity, this._collisionEntity);
      return true;
    }
    return false;
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

function collide(hitter, hurter) {
  const hitXPush = 1 + (hitter.px - hurter.px) * 0.5;
  const hitYPush = 1 + (hitter.py - hurter.py) * 0.5;
  hitter.vx += hitXPush;
  hitter.vy += hitYPush;
  hurter.vx -= hitXPush;
  hurter.vy -= hitYPush;
}

export { CerealEntity, CerealSpace };
