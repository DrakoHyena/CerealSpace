function generateOffsets(obj) {
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

export { generateOffsets };
