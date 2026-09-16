import { describe, expect, it } from "vitest";
import { getRaEffectiveConfig } from "./ra-effective-config.js";

describe("RA effective configuration", () => {
  it("fails closed for missing and malformed values", () => {
    expect(getRaEffectiveConfig({})).toEqual({
      commitmentsEnabled: false,
      dmPublicationEnabled: false,
      roomPublicationChannelId: null,
      roomSeedActive: false,
      socialCaptureEnabled: false,
      botDmPrincipal: null,
      dmPrincipal: null,
      dmCognitionEnabled: false,
    });
    expect(getRaEffectiveConfig({
      RA_COMMITMENTS: "TRUE",
      RA_DM_PUBLICATION: "yes",
      RA_ROOM_PUBLICATION: "   ",
      RA_ROOM_SEED_ACTIVE: "on",
      RA_SOCIAL_CAPTURE: "enabled",
      RA_BOT_DM: "   ",
      RA_DM_PRINCIPAL: "   ",
      RA_DM_COGNITION: "TRUE",
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
