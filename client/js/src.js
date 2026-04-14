const CERAL_ENTITY_OFFSETS = {
  px: 0, // 4
  py: 4, // 4
  vx: 8, // 4
  vy: 12, // 4
  w: 16, // 2
  h: 18, // 2
};

const BYTES_PER_ENTITY = 20;
const BYTES_PER_HEADER = 4;
const BYTES_PER_BLOCK = BYTES_PER_ENTITY + BYTES_PER_HEADER;

class CeralEntity {
  constructor(ceralSpace, index) {
    this.cs = ceralSpace;
    this.dv = ceralSpace.dv;
    this.id = this.dv.getUint32(index - BYTES_PER_HEADER);
    this.lastUpdate = 0;
    this._index = index;
  }

  get index() {
    if (this.lastUpdate !== this.cs.lastUpdate) {
      this._index = this.cs.idToDataIndex[this.id];
      this.lastUpdate = this.cs.lastUpdate;
    }
    return this._index;
  }

  get px() {
    return this.dv.getUint32(this.index + CERAL_ENTITY_OFFSETS.px);
  }
  set px(v) {
    this.dv.setUint32(this.index + CERAL_ENTITY_OFFSETS.px, v);
  }

  get py() {
    return this.dv.getUint32(this.index + CERAL_ENTITY_OFFSETS.py);
  }
  set py(v) {
    this.dv.setUint32(this.index + CERAL_ENTITY_OFFSETS.py, v);
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

function getMortonCode(x, y) {
  x = x >> 4;
  x = (x | (x << 8)) & 0x00ff00ff;
  x = (x | (x << 4)) & 0x0f0f0f0f;
  x = (x | (x << 2)) & 0x33333333;
  x = (x | (x << 1)) & 0x55555555;

  y = y >> 4;
  y = (y | (y << 8)) & 0x00ff00ff;
  y = (y | (y << 4)) & 0x0f0f0f0f;
  y = (y | (y << 2)) & 0x33333333;
  y = (y | (y << 1)) & 0x55555555;

  return x | (y << 1);
}

class CeralSpace {
  constructor() {
    this.buf = new ArrayBuffer(0xffffff - 1);
    this.dv = new DataView(this.buf);
    this.u8 = new Uint8Array(this.buf);
    this.tempBlock = new Uint8Array(BYTES_PER_BLOCK);
    this.freeIndex = 0;
    this.nextEntryId = 1;
    this.idToDataIndex = new Uint32Array(0xffffff - 1);
    this.lastUpdate = performance.now();

    this._dummyEntity = new CeralEntity(this, BYTES_PER_HEADER);
    this._dummyEntity2 = new CeralEntity(this, BYTES_PER_HEADER);
  }
  addEntity() {
    this.dv.setUint32(this.freeIndex, this.nextEntryId++);
    this.freeIndex += BYTES_PER_HEADER;
    const dataIndex = this.freeIndex;
    this.idToDataIndex[this.nextEntryId - 1] = dataIndex;
    this.freeIndex += BYTES_PER_ENTITY;
    return dataIndex;
  }
  deleteEntity(entryIndex) {
    const targetBlock = entryIndex - BYTES_PER_HEADER;
    const lastBlock = this.freeIndex - BYTES_PER_BLOCK;
    if (targetBlock < lastBlock) {
      this.u8.copyWithin(targetBlock, lastBlock, lastBlock + BYTES_PER_BLOCK);
      this.idToDataIndex[this.dv.getUint32(targetBlock)] = entryIndex;
    }
    this.freeIndex -= BYTES_PER_BLOCK;
  }
  sort() {
    const blockAmount = this.freeIndex / BYTES_PER_BLOCK;
    for (let i = 1; i < blockAmount; i++) {
      let j = i;
      while (j > 0) {
        const offsetJ = j * BYTES_PER_BLOCK;
        const offsetPrev = (j - 1) * BYTES_PER_BLOCK;
        const mortonJ = getMortonCode(
          this.dv.getUint32(
            offsetJ + BYTES_PER_HEADER + CERAL_ENTITY_OFFSETS.px,
          ),
          this.dv.getUint32(
            offsetJ + BYTES_PER_HEADER + CERAL_ENTITY_OFFSETS.py,
          ),
        );
        const mortonPrev = getMortonCode(
          this.dv.getUint32(
            offsetPrev + BYTES_PER_HEADER + CERAL_ENTITY_OFFSETS.px,
          ),
          this.dv.getUint32(
            offsetPrev + BYTES_PER_HEADER + CERAL_ENTITY_OFFSETS.py,
          ),
        );
        if (mortonJ < mortonPrev) {
          const idJ = this.dv.getUint32(offsetJ);
          const idPrev = this.dv.getUint32(offsetPrev);
          this.idToDataIndex[idJ] = offsetPrev + BYTES_PER_HEADER;
          this.idToDataIndex[idPrev] = offsetJ + BYTES_PER_HEADER;
          this.tempBlock.set(
            this.u8.subarray(offsetJ, offsetJ + BYTES_PER_BLOCK),
          );
          this.u8.copyWithin(offsetJ, offsetPrev, offsetPrev + BYTES_PER_BLOCK);
          this.u8.set(this.tempBlock, offsetPrev);
          j--;
        } else {
          break;
        }
      }
    }
  }
  getCollisions(entity, callback) {
    const blockAmount = this.freeIndex / BYTES_PER_BLOCK;
    const myDataIdx = entity.index;
    const myBlockIdx = (myDataIdx - BYTES_PER_HEADER) / BYTES_PER_BLOCK;

    // Cache current entity bounds for fast comparison
    const ax1 = entity.px;
    const ay1 = entity.py;
    const ax2 = ax1 + entity.w;
    const ay2 = ay1 + entity.h;

    // The "Window" size: how many neighbors in the buffer to check.
    // 32-64 is usually a sweet spot for high-performance Morton-sorted systems.
    const window = 32;
    const start = Math.max(0, myBlockIdx - window);
    const end = Math.min(blockAmount, myBlockIdx + window);

    for (let i = start; i < end; i++) {
      if (i === myBlockIdx) continue; // Don't collide with self

      const bDataIdx = i * BYTES_PER_BLOCK + BYTES_PER_HEADER;

      // Optimization: Read direct from DataView instead of creating a new Entity wrapper
      const bx1 = this.dv.getUint32(bDataIdx + CERAL_ENTITY_OFFSETS.px);
      const by1 = this.dv.getUint32(bDataIdx + CERAL_ENTITY_OFFSETS.py);
      const bw = this.dv.getUint16(bDataIdx + CERAL_ENTITY_OFFSETS.w);
      const bh = this.dv.getUint16(bDataIdx + CERAL_ENTITY_OFFSETS.h);

      // Fast AABB check
      if (ax1 < bx1 + bw && ax2 > bx1 && ay1 < by1 + bh && ay2 > by1) {
        // Return the ID of the hit entity to the callback
        this._dummyEntity2.id = this.dv.getUint32(bDataIdx - BYTES_PER_HEADER);
        this._dummyEntity._index = bDataIdx;
        this._dummyEntity.lastUpdate = this.lastUpdate;
        callback(entity, this._dummyEntity2);
      }
    }
  }
  loopEntities(cb) {
    const blockAmount = this.freeIndex / BYTES_PER_BLOCK;
    for (let i = 0; i < blockAmount; i++) {
      let offset = i * BYTES_PER_BLOCK;
      this._dummyEntity.id = this.dv.getUint32(offset);
      offset += BYTES_PER_HEADER;
      this._dummyEntity._index = offset;
      this._dummyEntity.lastUpdate = this.lastUpdate;
      cb(this._dummyEntity);
    }
  }
  worldLoop() {
    this.loopEntities((entity) => {
      movement(entity);
      this.getCollisions(entity, collide);
    });
    this.sort();
    this.lastUpdate = performance.now();
  }
}

function movement(entity) {
  entity.px += entity.vx;
  entity.py += entity.vy;
  entity.vx *= 0.9999;
  entity.vy *= 0.9999;
}

function collide(hitter, hurter) {
  const hitXPush = (hitter.px - hurter.px) * 0.5;
  const hitYPush = (hitter.py - hurter.py) * 0.5;
  const hurtXPush = (hurter.px - hitter.px) * 0.5;
  const hurtYPush = (hurter.py - hitter.py) * 0.5;
  hitter.px += hitXPush;
  hitter.py += hitYPush;
  hurter.px += hurtXPush;
  hurter.py += hurtYPush;
}

export { CeralEntity, CeralSpace };
