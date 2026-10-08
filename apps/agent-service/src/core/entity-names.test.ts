import { afterEach, describe, expect, it } from "vitest";
import { deliveryChannels, entityName, ownerName } from "./entity-names.js";
import { loadNuclearSystemPrompt } from "./conversation/prompts.js";
import { emptyActivityLicenseNote } from "./honesty/activity-license.js";
import { GROWTH_GUIDANCE } from "./cognitive-v021/thought/output-contract.js";

const KEYS = ["ASHLEY_ENTITY_NAME", "ASHLEY_OWNER_NAME", "ASHLEY_CHANNELS"] as const;

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe("entity names", () => {
  it("defaults to today's names when nothing is configured", () => {
    delete process.env.ASHLEY_ENTITY_NAME;
    delete process.env.ASHLEY_OWNER_NAME;
    delete process.env.ASHLEY_CHANNELS;
    expect(entityName()).toBe("Ashley");
    expect(ownerName()).toBe("Alex");
    expect(deliveryChannels()).toBe("Discord");
  });

  it("treats blank configuration as unset", () => {
    process.env.ASHLEY_ENTITY_NAME = "   ";
    process.env.ASHLEY_OWNER_NAME = "";
    process.env.ASHLEY_CHANNELS = " \t ";
    expect(entityName()).toBe("Ashley");
    expect(ownerName()).toBe("Alex");
    expect(deliveryChannels()).toBe("Discord");
  });

  it("reads configured names into prompts, the activity note, and growth guidance", () => {
    process.env.ASHLEY_ENTITY_NAME = "Nova";
    process.env.ASHLEY_OWNER_NAME = "Sam";
    const prompt = loadNuclearSystemPrompt("discord");
    expect(prompt).toContain("Nova cannot post to external sites");
    expect(prompt).not.toContain("Ashley cannot post to external sites");
    expect(prompt).toContain("Sam is my friend");
    expect(prompt).toContain("If Sam clearly says stop");
    expect(prompt).not.toContain("Alex");
    expect(prompt).not.toContain("{{");
    const note = emptyActivityLicenseNote();
    expect(note).toContain("If Sam asks directly");
    expect(note).not.toContain("If Alex asks directly");
    const guidance = GROWTH_GUIDANCE();
    expect(guidance).toContain("when Sam's reply");
    expect(guidance).toContain("Sam correction");
    expect(guidance).not.toContain("Alex");
  });
});
