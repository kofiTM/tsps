/**
 * Textures that flow slower when worn (kofi): the Fire cape's lava (40, also on the Fire max cape) and the
 * Infernal cape's (59, also on the Infernal max cape) scroll at their cache speed in the world, but on a
 * cape that strobed. Divisor of their scroll on actors (players and NPCs), by texture id; written into the
 * material table's spare row-1 column and read by the actor shaders.
 */
// kofi (2026-11-06): 4 -> 8 -> 16 -> 64 -> 128 (the most is 255: stored in a byte), and flowing the other way (the
// shaders reverse any worn flow with a slowdown set).
/**
 * Textures that scroll slower in the world (on scenery and the ground), by texture id: divisor of
 * their cache scroll speed, written into the material table's spare row-5 column and read by the
 * scene shaders (main.vert). Texture 34 is the gold sparkle on magic trees' leaves.
 */
// kofi (2026-11-07): magic tree sparkle 4 -> 64 slower; raise it until it looks right (max 255).
export const WORLD_FLOW_SLOWDOWN: ReadonlyMap<number, number> = new Map([
    [34, 64],
]);

export const WORN_FLOW_SLOWDOWN: ReadonlyMap<number, number> = new Map([
    [40, 128],
    [59, 128],
]);
