const CONFIG = {
  CerealSpace: {
    /*
     * How many entities to check collisions with
     * This is an early cut off from the calculated end
     */
    maxCollisionLoops: 1024,

    /*
     * Every X amount of ticks do collisions
     * Recommended to tweak maxCollisionLoops first
     * 1 = Every tick
     */
    collisionInterval: 1,

    /*
     * Every X amount of ticks sort entities
     * sorts also update the position data for collisions and queries
     * therefore, neither interval should be too far off from one another
     * 1 = Every tick
     */
    sortInterval: 1,

    /*
     * Maximum amount of entities at one time
     * Lowering this value may improve performance on some devices
     */
    maxEntities: 200_000,
  },
};

export { CONFIG };
