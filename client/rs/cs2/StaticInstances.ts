/**
 * Cache script 1935 answers "is this coord in an instance?" with `coordx >= 6400`, where OSRS builds its raid
 * copies. This server runs some instanced content on the static map instead, so the scripts gated on it never
 * run there - the Theatre of Blood's party HUD (script 2297) never showed its members' health orbs.
 * Each box here counts as an instance.
 */
export const INSTANCE_CHECK_SCRIPT_ID = 1935;

/** Static-map boxes that stand in for instances (inclusive tile bounds). */
const STATIC_INSTANCES = [
    // The Theatre of Blood (server Shared.TheatreOfBlood THEATRE).
    { minX: 3136, maxX: 3391, minY: 4224, maxY: 4479 },
];

/** Whether a packed coord (plane << 28 | x << 14 | y) is inside one of the static instances. */
export function isStaticInstance(coord: number): boolean {
    const x = (coord >> 14) & 0x3fff;
    const y = coord & 0x3fff;
    return STATIC_INSTANCES.some((box) => x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY);
}
