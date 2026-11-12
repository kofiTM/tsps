// node --test tests/boss-bots.test.cjs
// The shared boss bots (plugins/bosses/bossbots) at two bosses: a bot's drop log, deaths and chat carry
// from Nex to the Theatre of Blood and back. Run in a throwaway folder: Memory.BossBots saves to
// <cwd>/data/saves, so the real saves are never touched.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BOSSBOTS = path.join(__dirname, "..", "plugins", "bosses", "bossbots");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "boss-bots-test-"));
const home = process.cwd();
process.chdir(scratch);
const fresh = (name) => {
  delete require.cache[require.resolve(path.join(BOSSBOTS, name))];
  return require(path.join(BOSSBOTS, name));
};
let Memory = fresh("Memory.BossBots.js");
const Chatter = require(path.join(BOSSBOTS, "Chatter.BossBots.js"));
const Bosses = require(path.join(BOSSBOTS, "Bosses.BossBots.js"));
const Kit = require(path.join(BOSSBOTS, "Kit.BossBots.js"));
const Roster = require(path.join(BOSSBOTS, "Roster.BossBots.js"));
process.on("exit", () => {
  process.chdir(home);
  fs.rmSync(scratch, { recursive: true, force: true });
});

test("a bot's drop log keeps every boss apart and carries them all", () => {
  const nex = Memory.dropBook("nex");
  const tob = Memory.dropBook("tob");
  for (let i = 0; i < 5; i++) nex.record("Torva Tom", [`bones ${i}`], i === 3 ? "Torva platebody" : null, "duo");
  for (let i = 0; i < 4; i++) tob.record("Torva Tom", [`blood rune ${i}`], null);
  const all = Memory.everywhere("Torva Tom");
  assert.equal(all["nex [duo]"].kills, 5);
  assert.equal(all["nex [duo]"].drops.length, 5);
  assert.equal(all.tob.kills, 4);
  assert.deepEqual(all.tob.drops.map((drop) => drop.items[0]), ["blood rune 0", "blood rune 1", "blood rune 2", "blood rune 3"]);
  // Every boss together: 9 kills, the rare 5 kills ago at Nex.
  assert.equal(all.overall.kills, 9);
  assert.deepEqual(Memory.lastRare("Torva Tom"), { rare: "Torva platebody", rareAt: "nex [duo]" });
  // Lucky at ToB from the rare at Nex, and not dry anywhere.
  assert.equal(tob.luckyFor("Torva Tom"), 5);
  assert.equal(tob.dryFor("Torva Tom"), 0);
  assert.equal(nex.dryFor("Torva Tom"), 0);
});

test("a drop log keeps its last 100 kills per boss", () => {
  const tob = Memory.dropBook("tob");
  for (let i = 0; i < 120; i++) tob.record("Big Bones", [`drop ${i}`]);
  const kept = Memory.everywhere("Big Bones").tob;
  assert.equal(kept.kills, 120);
  assert.equal(kept.drops.length, Memory.DROP_MEMORY);
  assert.equal(kept.drops[0].items[0], "drop 20");
});

test("dry is judged over every boss: a long run at ToB after a rare at Nex", () => {
  const nex = Memory.dropBook("nex");
  const tob = Memory.dropBook("tob");
  nex.record("Dry Dan", ["ancient hilt"], "Ancient hilt");
  for (let i = 0; i < 90; i++) tob.record("Dry Dan", ["junk"]);
  assert.ok(tob.dryFor("Dry Dan") >= 80, "past the longest dry spell (80) it's dry, at any boss");
  assert.equal(nex.dryFor("Dry Dan"), tob.dryFor("Dry Dan"));
});

test("saves are put off, then written once in the background", async () => {
  const file = path.join(scratch, "data", "saves", "boss-bot-deaths.json");
  Memory.recordDeath("Quiet Quinn", "nex", "melee");
  Memory.recordDeath("Quiet Quinn", "tob", "the maiden");
  assert.equal(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8"))["Quiet Quinn"] : undefined, undefined, "not written on the spot");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8"))["Quiet Quinn"].length, 2, "both written together a moment later");
});

test("the memory outlasts a restart (saved to disk, read back)", () => {
  // As the server stopping does: anything unsaved written first.
  Memory.flush();
  Memory = fresh("Memory.BossBots.js");
  const all = Memory.everywhere("Torva Tom");
  assert.equal(all.tob.kills, 4);
  assert.equal(all["nex [duo]"].kills, 5);
  assert.ok(fs.existsSync(path.join(scratch, "data", "saves", "boss-bot-drops.json")));
});

test("deaths from every boss, named for whichever boss the bots are at", () => {
  Memory.recordDeath("Rag Rex", "nex", "no escape");
  Memory.recordDeath("Rag Rex", "tob", "the maiden's blood");
  assert.deepEqual({ ...Memory.lastDeath("Rag Rex"), at: 0 }, { boss: "tob", cause: "the maiden's blood", at: 0 });
  Memory.recordHumanDeath("Rag Rex", "kofi", "tob", "verzik's webs");
  assert.equal(Memory.lastHumanDeath("Rag Rex", "kofi", "tob").cause, "verzik's webs");
  assert.equal(Memory.lastHumanDeath("Rag Rex", "kofi", "nex"), null);
  assert.equal(Bosses.bossName("tob"), "the theatre");
  assert.equal(Bosses.bossName("maiden"), "maiden");
  assert.equal(Bosses.bossName("nex"), "nex");
});

test("chat is kept apart per boss: a chat had at Nex can still come up at ToB", () => {
  const atNex = Memory.chatMemory("nex");
  const atTob = Memory.chatMemory("tob");
  assert.equal(atNex.fresh(["hi"], "k"), "hi");
  assert.equal(atNex.fresh(["hi"], "k"), null);
  assert.equal(atTob.fresh(["hi"], "k"), "hi");
});

/** Every conversation at `boss`, many times over, for every personality. */
function conversations(boss) {
  const personas = Object.keys(Chatter.PRE);
  const all = [];
  for (let round = 0; round < 30; round++) {
    for (const mode of ["pre", "post"]) {
      for (const starter of personas) {
        const others = personas.filter((p) => p !== starter).slice(round % 5, (round % 5) + 2);
        const lines = Chatter.conversation(mode, starter, others, boss);
        if (lines) all.push({ mode, starter, lines });
      }
    }
    Chatter.kill();
  }
  return all;
}

// kofi (2026-11-03): naming another group boss or raid is fine anywhere ("{elsewhere}" can be Nex at the
// Theatre); what must not leak is Nex's own fight talk.
test("at ToB the shared chat never talks about Nex's fight, and every blank is filled", () => {
  const chats = conversations("tob");
  assert.ok(chats.length > 500);
  for (const { lines } of chats) {
    for (const { text } of lines) {
      assert.doesNotMatch(text, /\{\w+\}|\[\w+\] /, `unfilled: ${text}`);
      assert.doesNotMatch(text, /smoke|torva|zaros phase/i, `about Nex's fight at ToB: ${text}`);
    }
  }
  assert.ok(chats.some(({ lines }) => lines.some(({ text }) => /the theatre|scythe/i.test(text))), "a line names ToB's boss or drop");
});

test("at Nex its own tagged lines still come up, without the tag", () => {
  const texts = conversations("nex").flatMap(({ lines }) => lines.map((line) => line.text));
  for (const text of texts) assert.doesNotMatch(text, /\{\w+\}|\[\w+\] /, `unfilled: ${text}`);
  assert.ok(texts.some((text) => /smoke|torva|winged general/i.test(text)), "a Nex-only line came up at Nex");
});

test("every question is handed back by a teammate before the asker answers, at any boss", () => {
  for (const boss of ["nex", "tob"]) {
    for (const { lines } of conversations(boss)) {
      if (lines.length > 1) assert.notEqual(lines[1].who, -1, `answered its own line: ${lines[0].text}`);
    }
  }
});

test("a bot already in one fight is never picked for another", () => {
  const last = Roster.NAMES.length - 1;
  const online = new Set(Roster.NAMES.slice(0, last));
  Kit.init({ core: { World: { getPlayerByName: (name) => online.has(name), getAddPlayerQueue: () => [] } } });
  assert.equal(Kit.freeName(), Roster.NAMES[last]);
  online.add(Roster.NAMES[last]);
  assert.match(Kit.freeName("Tob Helper"), /^Tob Helper\d+$/);
});
