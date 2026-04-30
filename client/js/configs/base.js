const CONFIG = {
  CerealSpace: {
    /*
     * How many entities to check collisions with
     * This is an early cut off from the calculated end
     */
    maxCollisionLoops: 32,

    /*
     * Every X amount of ticks do collisions
     * Recommended to tweak maxCollisionLoops first
     * 1 = Every tick
     */
    collisionInterval: 3,

    /*
     * Every X amount of ticks sort entities
     * sorts also update the position data for collisions and queries
     * therefore, neither interval should be too far off from one another
     * 1 = Every tick
     */
    sortInterval: 6,

    /*
     * Maximum amount of entities at one time
     * Lowering this value may improve performance on some devices
     */
    maxEntities: 200_000,

    /*
     * The area the entities have to exit
     * Note: Entities can travel up to 65535 (0xffff)
     * This acts as an early cut off before that point
     */
    width: 0xffff,
    height: 0xffff,

    /*
     * Whether or not entities should wrap to the other side when hitting
     * space borders or 0xffff
     */
    wrapping: true,
  },
};

export { CONFIG };
