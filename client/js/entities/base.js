import { generateOffsets } from "/js/entities/util.js";

const [CEREAL_ENTITY_OFFSETS, CEREAL_U32_ENTITY_OFFSETS] = generateOffsets({
  px: 2,
  py: 2,
  vx: 4,
  vy: 4,
  w: 2,
  h: 2,
});

const [CEREAL_HEADER_OFFSETS, CEREAL_U32_HEADER_OFFSETS] = generateOffsets({
  id: 4,
});

const BYTES_PER_ENTITY = CEREAL_ENTITY_OFFSETS._totalBytes;
const BYTES_PER_HEADER = CEREAL_HEADER_OFFSETS._totalBytes;
const BYTES_PER_BLOCK = BYTES_PER_ENTITY + BYTES_PER_HEADER;

const u32_PER_ENTITY = CEREAL_U32_ENTITY_OFFSETS._totalBytes;
const U32_PER_HEADER = CEREAL_U32_HEADER_OFFSETS._totalBytes;
const u32_PER_BLOCK = U32_PER_HEADER + u32_PER_ENTITY;

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

export {
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
};
