import assert from "node:assert/strict";

import { NpcUpdateDecoder } from "../game/sync/NpcUpdateDecoder";
import { encodeClientMessage } from "../network/packet/ClientBinaryEncoder";
import { LOGIN_FLAG_NPC_TRANSFORM } from "../network/serverConnection/constants";
import {
    createNpcSyncState,
    decodeClientPacket,
    encodeNpcSync,
} from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

/**
 * NPC transformation (OSRS rev 241 npc extended info, mask 0x2): a change of type is sent in
 * place, so the NPC keeps its tile, walk and facing instead of being removed and added again.
 * A Theatre of Blood nylocas changing style: Ischyros (8342, melee) to Toxobolos (8343, ranged).
 *
 * Only a client that says so at login (LOGIN_FLAG_NPC_TRANSFORM) gets the block: a client from
 * before it can't skip it, so it misreads the blocks after it and loses every NPC.
 */
function decodeNpcs(packet: Buffer, decoder: NpcUpdateDecoder) {
    const body = packet.subarray(3);
    const length = body.readUInt16BE(9);
    return decoder.decode(body.subarray(11, 11 + length), {
        large: body[4] === 1,
        loopCycle: 0,
        clientCycle: 100,
        localTileX: 3200,
        localTileY: 3200,
        level: 0,
    });
}

const local = { x: 3200, y: 3200, level: 0 };

function inPlace(): void {
    const state = createNpcSyncState();
    const decoder = new NpcUpdateDecoder();
    const sync = (tick: number, views: any[]) =>
        decodeNpcs(encodeNpcSync(tick, local, views, state, undefined, undefined, true), decoder);
    const view = (typeId: number, x: number, walkDirection: number, transparency?: object) => ({
        index: 12, typeId, spawnTypeId: 8342, x, y: 3204, level: 0,
        rotation: 0, walkDirection, runDirection: -1, transparency,
    });

    let decoded = sync(1, [view(8342, 3204, -1)]);
    assert.equal(decoded.spawns[0]?.typeId, 8342);

    // It changes style while walking east, with another block alongside.
    decoded = sync(2, [view(8343, 3205, 4, { startCycles: 0, endCycles: 30, from: -1, to: 0 })]);
    assert.deepEqual(decoded.removals, [], "not removed");
    assert.deepEqual(decoded.spawns, [], "not added again");
    assert.deepEqual(decoded.movements.map((move) => move.directions), [[4]], "its step is kept");
    const block = decoded.updateBlocks.get(12);
    assert.equal(block?.transformTypeId, 8343);
    assert.deepEqual(block?.transparency, { startCycle: 100, endCycle: 130, from: -1, to: 0 }, "the other blocks stay aligned");

    // No change of type, no transformation.
    decoded = sync(3, [view(8343, 3205, -1)]);
    assert.equal(decoded.updateBlocks.get(12), undefined);

    // A later teleport is still a re-add of the same NPC (its new type is the one remembered).
    decoded = sync(4, [view(8343, 3210, -1)]);
    assert.deepEqual(decoded.removals, [], "a teleport keeps the NPC");
    assert.equal(decoded.spawns[0]?.teleport, true);
    assert.equal(decoded.spawns[0]?.typeId, 8343);

    // Another NPC given its index (a new spawn type) is a removal and a new NPC, not a transformation.
    decoded = sync(5, [{ ...view(8344, 3210, -1), spawnTypeId: 8344 }]);
    assert.deepEqual(decoded.removals, [12]);
    assert.equal(decoded.spawns[0]?.typeId, 8344);
    assert.equal(decoded.updateBlocks.get(12)?.transformTypeId, undefined);
}

/** The Maiden's 70% form (8360 to 8361) while her blood spawn is hit, and Verzik growing (size 3 to 7). */
function bossesWithOtherBlocks(): void {
    const state = createNpcSyncState();
    const decoder = new NpcUpdateDecoder();
    const sync = (tick: number, views: any[]) =>
        decodeNpcs(encodeNpcSync(tick, local, views, state, undefined, undefined, true), decoder);
    const npc = (index: number, typeId: number, spawnTypeId: number, extra = {}) => ({
        index, typeId, spawnTypeId, x: 3200 + index, y: 3203, level: 0,
        rotation: 0, walkDirection: -1, runDirection: -1, ...extra,
    });
    const anim = { animation: { id: 8100, delay: 0 } };
    sync(1, [npc(5, 8360, 8360), npc(6, 8372, 8370), npc(9, 8367, 8367)]);
    const decoded = sync(2, [
        npc(5, 8361, 8360, anim), npc(6, 8373, 8370, anim), npc(9, 8367, 8367, anim), npc(10, 8366, 8366, anim),
    ]);
    assert.deepEqual(decoded.removals, []);
    assert.deepEqual(decoded.localNpcIds, [5, 6, 9, 10], "every NPC kept, the new crab added");
    assert.equal(decoded.updateBlocks.get(5)?.transformTypeId, 8361);
    assert.equal(decoded.updateBlocks.get(6)?.transformTypeId, 8373);
    for (const index of [5, 6, 9, 10]) assert.equal(decoded.updateBlocks.get(index)?.seq?.id, 8100, "blocks after it stay aligned");
}

/** A client that didn't say it reads the block: a type change is a removal and an add, as before. */
function olderClients(): void {
    const state = createNpcSyncState();
    const decoder = new NpcUpdateDecoder();
    const sync = (tick: number, views: any[]) => decodeNpcs(encodeNpcSync(tick, local, views, state), decoder);
    const view = (typeId: number) => ({
        index: 5, typeId, spawnTypeId: 8360, x: 3203, y: 3203, level: 0, rotation: 0, walkDirection: -1, runDirection: -1,
    });
    sync(1, [view(8360)]);
    const decoded = sync(2, [view(8361)]);
    assert.deepEqual(decoded.removals, [5]);
    assert.equal(decoded.spawns[0]?.typeId, 8361);
    assert.equal(decoded.updateBlocks.get(5), undefined, "no transformation block");
}

/** Every login this client sends says it reads the block, whatever other flags it carries. */
function loginAnnouncesIt(): void {
    for (const flags of [0, 1, 2]) {
        const bytes = encodeClientMessage({
            type: "login", payload: { username: "tobtester", password: "x", revision: 241, flags },
        });
        const packet = decodeClientPacket(Buffer.from(bytes)) as any;
        assert.equal(packet?.type, "login");
        assert.equal(packet.flags, flags | LOGIN_FLAG_NPC_TRANSFORM);
    }
}

inPlace();
bossesWithOtherBlocks();
olderClients();
loginAnnouncesIt();
console.log("NPC transformation tests passed");
