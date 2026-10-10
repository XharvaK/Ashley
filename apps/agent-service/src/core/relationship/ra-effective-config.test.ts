import { describe, expect, it } from "vitest";
import { getRaEffectiveConfig } from "./ra-effective-config.js";

describe("RA effective configuration", () => {
  it("fails closed for missing and malformed values; contact DMs are on unless switched off", () => {
    expect(getRaEffectiveConfig({})).toEqual({
      commitmentsEnabled: false,
      dmPublicationEnabled: true,
      roomPublicationChannelId: null,
      roomSeedActive: false,
      socialCaptureEnabled: true,
      botDmPrincipal: null,
      dmPrincipal: null,
      dmCognitionEnabled: true,
    });
    expect(getRaEffectiveConfig({
      RA_COMMITMENTS: "maybe",
      RA_DM_PUBLICATION: "false",
      RA_ROOM_PUBLICATION: "   ",
      RA_ROOM_SEED_ACTIVE: "enabled",
      RA_SOCIAL_CAPTURE: "0",
      RA_BOT_DM: "   ",
      RA_DM_PRINCIPAL: "   ",
      RA_DM_COGNITION: " OFF ",
    })).toEqual({
      commitmentsEnabled: false,
      dmPublicationEnabled: false,
      roomPublicationChannelId: null,
      roomSeedActive: false,
      socialCaptureEnabled: false,
      botDmPrincipal: null,
      dmPrincipal: null,
      dmCognitionEnabled: false,
    });
  });

  it("reads TRUE, yes and on as on, like env.ts and the bot (A11-10)", () => {
    expect(getRaEffectiveConfig({ RA_COMMITMENTS: "TRUE", RA_ROOM_SEED_ACTIVE: "on" })).toMatchObject({ commitmentsEnabled: true, roomSeedActive: true });
    expect(getRaEffectiveConfig({ RA_COMMITMENTS: " yes " }).commitmentsEnabled).toBe(true);
    expect(getRaEffectiveConfig({ RA_DM_COGNITION: "no" }).dmCognitionEnabled).toBe(false);
  });

  it("accepts the existing true and 1 forms without changing defaults", () => {
    expect(getRaEffectiveConfig({
      RA_COMMITMENTS: "true",
      RA_DM_PUBLICATION: "1",
      RA_ROOM_PUBLICATION: " room-channel ",
      RA_ROOM_SEED_ACTIVE: "true",
      RA_SOCIAL_CAPTURE: "1",
      RA_BOT_DM: " bot-principal ",
      RA_DM_PRINCIPAL: " dm-principal ",
      RA_DM_COGNITION: "1",
    })).toEqual({
      commitmentsEnabled: true,
      dmPublicationEnabled: true,
      roomPublicationChannelId: "room-channel",
      roomSeedActive: true,
      socialCaptureEnabled: true,
      botDmPrincipal: "bot-principal",
      dmPrincipal: "dm-principal",
      dmCognitionEnabled: true,
    });
  });
});
