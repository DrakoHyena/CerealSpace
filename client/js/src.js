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
    this.idToDataIndex = new Uint32Array(0x1000000 >> 4);

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

    // Shrink the active world size
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
        const dataIndex = i + BYTES_PER_HEADER;
        const px = srcDv.getUint16(dataIndex + CERAL_ENTITY_OFFSETS.px);
        const py = srcDv.getUint16(dataIndex + CERAL_ENTITY_OFFSETS.py);
        key = (MORTON_LUT[px] | (MORTON_LUT[py] << 1)) >>> 0;
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

    const ax1 = this.dv.getUint16(
      aIndex + BYTES_PER_HEADER + CERAL_ENTITY_OFFSETS.px,
    );
    const ay1 = this.dv.getUint16(
      aIndex + BYTES_PER_HEADER + CERAL_ENTITY_OFFSETS.py,
    );
    const ax2 =
      ax1 +
      this.dv.getUint16(aIndex + BYTES_PER_HEADER + CERAL_ENTITY_OFFSETS.w);
    const ay2 =
      ay1 +
      this.dv.getUint16(aIndex + BYTES_PER_HEADER + CERAL_ENTITY_OFFSETS.h);

    // Foward search
    const maxItrs = 2048;
    const end = Math.min(this.freeIndex, aIndex + maxItrs * BYTES_PER_BLOCK);

    const keyCutoff =
      (MORTON_LUT[(ax2 | -(ay2 >> 16)) & 0xffff] |
        (MORTON_LUT[(ay2 | -(ay2 >> 16)) & 0xffff] << 1)) >>>
      0;
    for (let i = aIndex + BYTES_PER_BLOCK; i < end; i += BYTES_PER_BLOCK) {
      const bKey = this.dv.getUint32(i + CERAL_HEADER_OFFSETS.sortKey);
      if (bKey > keyCutoff) break;

      // Collision check
      const bx1 = this.dv.getUint16(
        i + BYTES_PER_HEADER + CERAL_ENTITY_OFFSETS.px,
      );
      const by1 = this.dv.getUint16(
        i + BYTES_PER_HEADER + CERAL_ENTITY_OFFSETS.py,
      );
      const bx2 =
        bx1 + this.dv.getUint16(i + BYTES_PER_HEADER + CERAL_ENTITY_OFFSETS.w);
      const by2 =
        by1 + this.dv.getUint16(i + BYTES_PER_HEADER + CERAL_ENTITY_OFFSETS.h);

      if (ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1) {
        this._collisionEntity.index = i + BYTES_PER_HEADER;
        this._collisionEntity.id = this.dv.getUint32(
          i + CERAL_HEADER_OFFSETS.id,
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
