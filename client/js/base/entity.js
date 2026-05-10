const [CEREAL_ENTITY_OFFSETS, CEREAL_U32_ENTITY_OFFSETS] = generateEntityOffsets({
  px: 2,
  py: 2,
  vx: 4,
  vy: 4,
  w: 2,
  h: 2,
});

const [CEREAL_HEADER_OFFSETS, CEREAL_U32_HEADER_OFFSETS] = generateEntityOffsets({
  id: 4,
});

const BYTES_PER_ENTITY = CEREAL_ENTITY_OFFSETS._totalBytes;
const BYTES_PER_HEADER = CEREAL_HEADER_OFFSETS._totalBytes;
const BYTES_PER_BLOCK = BYTES_PER_ENTITY + BYTES_PER_HEADER;

const u32_PER_ENTITY = CEREAL_U32_ENTITY_OFFSETS._totalBytes;
const U32_PER_HEADER = CEREAL_U32_HEADER_OFFSETS._totalBytes;
const u32_PER_BLOCK = U32_PER_HEADER + u32_PER_ENTITY;

class CerealEntity {
  constructor(cerealSpace, index, dontUseId = false) {
    this.cs = cerealSpace;
    this.dontUseId = dontUseId;
    this.id =
      this.dontUseId ||
      this.cs.dv.getUint32(
        index - BYTES_PER_HEADER + CEREAL_HEADER_OFFSETS.id,
        true,
      );
    this.index = index;
    this.exists = true;
  }

  sync() {
    if (this.dontUseId) throw new Error("Cannot sync on id-less entity views!");
    this.index = this.cs.idToDataIndex[this.id];
    this.exists = this.index !== 1;
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

function generateEntityOffsets(obj) {
  // Verify alignedness
  const keys = Object.keys(obj);
  const values = Object.values(obj);
  let currentBytes = 4;
  for (let i = 0; i < values.length; i++) {
    currentBytes = currentBytes - values[i];
    if (currentBytes < 0) {
      if (obj[keys[i]] > 4) {
        throw new Error(`Offset property "${keys[i]}" is larger than 4 bytes`);
      } else {
        console.warn(
          `Offset property "${keys[i - 1]}" is not U32 aligned. Adding padding to compensate.`,
        );
        obj[keys[i - 1]] = 4;
        currentBytes = 4;
      }
    } else if (currentBytes === 0) {
      currentBytes = 4;
    }
  }
  if (currentBytes !== 4) {
    console.warn(`Offset not U32 aligned. Adding padding to compensate.`);
    obj[keys[values.length - 1]] = 4;
  }

  // Convert offsets
  let convertedOffset = {};
  let convertedOffsetU32 = {};
  let totalBytes = 0;
  for (let key in obj) {
    const u32Total = totalBytes * 0.25;
    if (u32Total !== (u32Total | 0)) {
      // Not u32 aligned, illegal
      Object.defineProperty(convertedOffsetU32, key, {
        get() {
          throw new Error(
            `Cannot get offset property "${key}" as U32 because index ${u32Total} is not a U32 aligned index`,
          );
        },
      });
    } else {
      convertedOffsetU32[key] = u32Total;
    }
    convertedOffset[key] = totalBytes;
    totalBytes += obj[key];
  }
  convertedOffset._totalBytes = totalBytes;
  convertedOffsetU32._totalBytes = totalBytes * 0.25;

  return [convertedOffset, convertedOffsetU32];
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
