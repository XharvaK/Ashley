import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ActivityType, type DMChannel, type SendableChannels } from "discord.js";
import { PLAYING_NAME, discordActivities } from "../presence.js";
import { sendBubbles } from "../chat/send-bubbles.js";
import { performSoftAct } from "../soft/soft-pump.js";
import {
  AVATAR_ASLEEP,
  AVATAR_AWAKE,
  BODY_FACE_FLOOR_MS,
  emptyFaceMemory,
  loadFaceMemory,
  moodFace,
  reconcileFaceWindow,
  saveFaceMemory,
  type FaceReconcileInput,
} from "./face-window.js";

const NOW = 1_700_000_000_000;
const GLAD = "avatar/mood-glad.png";
const FRAYED = "avatar/mood-frayed.png";
const LOW = "avatar/mood-low.png";

function harness(art = new Set([AVATAR_AWAKE, AVATAR_ASLEEP, GLAD, FRAYED])) {
  const worn: string[] = [];
  const input: FaceReconcileInput = {
    nowMs: NOW,
    phase: "awake",
    healthy: true,
    memory: { ...emptyFaceMemory(), avatarId: AVATAR_AWAKE, dot: "online" },
    loggedMissing: new Set<string>(),
    readArt: (id) => (art.has(id) ? Buffer.from(id) : null),
    setDot: async () => undefined,
    setAvatar: async (bytes) => { worn.push(bytes.toString()); },
    logMissing: () => undefined,
  };
  return { input, worn };
}

async function at(box: ReturnType<typeof harness>, offsetMs: number, patch: Partial<FaceReconcileInput>): Promise<void> {
  Object.assign(box.input, { nowMs: NOW + offsetMs }, patch);
  await reconcileFaceWindow(box.input);
}

describe("UX W3 Face (body): her avatar follows her Sim's mood while the game is live", () => {
  it("maps the game's moods through the pack's mood map", () => {
    assert.equal(moodFace("Mood_Happy"), GLAD);
    assert.equal(moodFace("Mood_Flirty"), GLAD);
    assert.equal(moodFace("Mood_Stressed"), FRAYED);
    assert.equal(moodFace("Mood_Uncomfortable"), FRAYED);
    assert.equal(moodFace("Mood_Sad"), LOW);
    assert.equal(moodFace("Mood_Playful"), "avatar/mood-spark.png");
    assert.equal(moodFace("Mood_Focused"), "avatar/mood-focused.png");
    assert.equal(moodFace("Mood_Fine"), AVATAR_AWAKE);
    assert.equal(moodFace("Mood_Asleep"), AVATAR_AWAKE);
    assert.equal(moodFace(null), null);
  });

  it("changes when the mood changes, never faster than the floor, and comes back after the game", async () => {
    const box = harness();
    box.input.memory.avatarChangeAtMs = [NOW - 2 * BODY_FACE_FLOOR_MS];
    await at(box, 0, { game: { live: true, mood: "Mood_Happy" } });
    assert.deepEqual(box.worn, [GLAD]);
    assert.equal(box.input.memory.bodyWorn, true);
    await at(box, 60_000, { game: { live: true, mood: "Mood_Stressed" } });
    assert.deepEqual(box.worn, [GLAD], "inside the floor the face waits");
    await at(box, BODY_FACE_FLOOR_MS, { game: { live: true, mood: "Mood_Stressed" } });
    assert.deepEqual(box.worn, [GLAD, FRAYED]);
    await at(box, BODY_FACE_FLOOR_MS + 60_000, { game: { live: true, mood: "Mood_Stressed" } });
    assert.deepEqual(box.worn, [GLAD, FRAYED], "the same mood changes nothing");
    await at(box, 2 * BODY_FACE_FLOOR_MS, { game: { live: true, mood: null } });
    assert.deepEqual(box.worn, [GLAD, FRAYED], "an unknown mood keeps the face");
    await at(box, 3 * BODY_FACE_FLOOR_MS, { game: undefined });
    assert.deepEqual(box.worn, [GLAD, FRAYED, AVATAR_AWAKE]);
    assert.equal(box.input.memory.bodyWorn, false);
  });

  it("a mood with no art keeps her face; after a night game she goes to sleep, or to the face she chose", async () => {
    const box = harness();
    await at(box, 0, { game: { live: true, mood: "Mood_Sad" } });
    assert.deepEqual(box.worn, []);
    await at(box, 0, { game: { live: true, mood: "Mood_Happy" } });
    assert.deepEqual(box.worn, [GLAD]);
    await at(box, BODY_FACE_FLOOR_MS, { phase: "night", game: undefined });
    assert.deepEqual(box.worn, [GLAD, AVATAR_ASLEEP]);
    assert.equal(box.input.memory.sleeping, true);

    const chose = harness(new Set([AVATAR_AWAKE, GLAD, "avatar/weather-rain.png"]));
    chose.input.memory.chosenId = "avatar/weather-rain.png";
    await at(chose, 0, { game: { live: true, mood: "Mood_Happy" } });
    await at(chose, BODY_FACE_FLOOR_MS, { game: undefined });
    assert.deepEqual(chose.worn, [GLAD, "avatar/weather-rain.png"]);
  });

  it("a face she chooses while the game is live is worn after it", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "body-"));
    saveFaceMemory({ ...emptyFaceMemory(), avatarId: GLAD, bodyWorn: true }, dataDir);
    const set: Buffer[] = [];
    const outcome = await performSoftAct({ actId: 1, request: { kind: "face", wardrobeId: "weather-rain" } }, {
      ownerDm: async () => ({}) as DMChannel,
      readArt: () => Buffer.from("rain"),
      setAvatar: async (bytes) => { set.push(bytes); },
      searchGif: async () => null,
      gifSearchAvailable: () => false,
      dataDir,
      nowMs: () => NOW,
    });
    assert.deepEqual(outcome, { status: "done", reason: "worn_at_wake" });
    assert.equal(set.length, 0);
    assert.equal(loadFaceMemory(dataDir).chosenId, "avatar/weather-rain.png");
  });
});

describe("UX W3 Window and Kept thinking on Discord", () => {
  it("shows Playing The Sims 4 first while the game is live, her own text after it", () => {
    assert.deepEqual(discordActivities(null, true), [{ name: PLAYING_NAME, type: ActivityType.Playing }]);
    assert.deepEqual(discordActivities("Reading.", true), [
      { name: "The Sims 4", type: ActivityType.Playing },
      { name: "Reading.", type: ActivityType.Custom },
    ]);
    assert.deepEqual(discordActivities("Reading."), [{ name: "Reading.", type: ActivityType.Custom }]);
  });

  it("her first bubble replies to the old message; the rest follow plainly", async () => {
    const sends: unknown[] = [];
    const channel = { send: async (payload: unknown) => { sends.push(payload); return {} as never; } } as SendableChannels;
    await sendBubbles(channel, ["found it", "the otters"], null, null, undefined, { replyToMessageId: "123456789012" });
    assert.deepEqual(sends, [
      { content: "found it", reply: { messageReference: "123456789012", failIfNotExists: false } },
      "the otters",
    ]);
  });
});
