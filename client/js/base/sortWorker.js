/**
 * Optimized CerealSpace Sort Worker
 * Reductions:
 * - Entity data is read only ONCE.
 * - Both histograms are generated in the first pass.
 * - Minimal SharedArrayBuffer contention.
 */

const MORTON_LUT = new Uint32Array(65536);
for (let i = 0; i < 65536; i++) {
  let x = i;
  x = (x | (x << 8)) & 0x00ff00ff;
  x = (x | (x << 4)) & 0x0f0f0f0f;
  x = (x | (x << 2)) & 0x33333333;
  x = (x | (x << 1)) & 0x55555555;
  MORTON_LUT[i] = x;
}

let entityBuf, rankToIndexA, rankToIndexB, mortonKeysA, mortonKeysB;
let pxOff, pyOff, BYTES_PER_BLOCK, BYTES_PER_HEADER;

// Radix memory: Two histograms, two sets of offsets
const counts0 = new Uint32Array(65536);
const counts1 = new Uint32Array(65536);
const offsets = new Uint32Array(65536);

// Key/Index Caches (Local memory is 10x faster than Shared memory)
let cachedKeys = new Uint32Array(0);
let cachedIndices = new Uint32Array(0);
let tempKeys = new Uint32Array(0);
let tempIndices = new Uint32Array(0);

self.onmessage = (e) => {
  const data = e.data;

  if (data.type === "init") {
    entityBuf = data.entityBuf;
    rankToIndexA = new Uint32Array(data.rankToIndexBufA);
    rankToIndexB = new Uint32Array(data.rankToIndexBufB);
    mortonKeysA = new Uint32Array(data.mortonBufA); // Buffer A
    mortonKeysB = new Uint32Array(data.mortonBufB); // Buffer B
    pxOff = data.pxOffset;
    pyOff = data.pyOffset;
    BYTES_PER_BLOCK = data.BYTES_PER_BLOCK;
    BYTES_PER_HEADER = data.BYTES_PER_HEADER;
    return;
  }

  if (data.type === "sort") {
    const { blockCount, activeBlockToIndex } = data;
    const dv = new DataView(entityBuf);

    // Select correct buffers
    const srcIdx = activeBlockToIndex === 0 ? rankToIndexA : rankToIndexB;
    const dstIdx = activeBlockToIndex === 0 ? rankToIndexB : rankToIndexA;
    const dstKys = activeBlockToIndex === 0 ? mortonKeysB : mortonKeysA;

    // Ensure local caches are ready
    if (cachedKeys.length < blockCount) {
      cachedKeys = new Uint32Array(blockCount);
      cachedIndices = new Uint32Array(blockCount);
      tempKeys = new Uint32Array(blockCount);
      tempIndices = new Uint32Array(blockCount);
    }

    counts0.fill(0);
    counts1.fill(0);

    // --- LOOP 1: READ ONCE, GENERATE BOTH HISTOGRAMS ---
    // This is the only loop that touches the slow DataView/SAB
    for (let i = 0; i < blockCount; i++) {
      const blockIdx = srcIdx[i];
      const dataIdx = blockIdx * BYTES_PER_BLOCK + BYTES_PER_HEADER;

      // Use true for Little Endian speed
      const px = dv.getUint16(dataIdx + pxOff, true);
      const py = dv.getUint16(dataIdx + pyOff, true);

      const key = (MORTON_LUT[px] | (MORTON_LUT[py] << 1)) >>> 0;

      cachedKeys[i] = key;
      cachedIndices[i] = blockIdx;

      counts0[key & 0xffff]++;
      counts1[(key >>> 16) & 0xffff]++;
    }

    // --- PASS 1: SHUFFLE LOW ---
    let total = 0;
    for (let i = 0; i < 65536; i++) {
      offsets[i] = total;
      total += counts0[i];
    }

    for (let i = 0; i < blockCount; i++) {
      const key = cachedKeys[i];
      const target = offsets[key & 0xffff]++;
      tempKeys[target] = key;
      tempIndices[target] = cachedIndices[i];
    }

    // --- PASS 2: SHUFFLE HIGH (FINAL WRITE) ---
    total = 0;
    for (let i = 0; i < 65536; i++) {
      offsets[i] = total;
      total += counts1[i];
    }

    for (let i = 0; i < blockCount; i++) {
      const key = tempKeys[i];
      const target = offsets[(key >>> 16) & 0xffff]++;

      // Final write to SharedArrayBuffers
      dstIdx[target] = tempIndices[i];
      dstKys[target] = key;
    }

    self.postMessage({ type: "complete" });
  }
};
