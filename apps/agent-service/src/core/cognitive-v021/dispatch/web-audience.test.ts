import { describe, expect, it } from "vitest";
import { isWebOperationKind, webAudienceRefused } from "./web-audience.js";

describe("web audience at dispatch", () => {
  it("names the three web observations", () => {
    expect(isWebOperationKind("web.search")).toBe(true);
    expect(isWebOperationKind("web.fetch")).toBe(true);
    expect(isWebOperationKind("web.request")).toBe(true);
    expect(isWebOperationKind("project.inspect")).toBe(false);
  });

  it("serves a web action only to the Owner's private audience", () => {
    for (const kind of ["web.search", "web.fetch", "web.request"]) {
      expect(webAudienceRefused(kind, { kind: "owner_private" })).toBe(false);
      expect(webAudienceRefused(kind, { kind: "room", roomId: "room-a" })).toBe(true);
      expect(webAudienceRefused(kind, { kind: "dm", principalId: "contact-a" } as never)).toBe(true);
      expect(webAudienceRefused(kind, { kind: "owner_dm", threadId: "thread-a" })).toBe(true);
      expect(webAudienceRefused(kind, undefined)).toBe(true);
    }
  });

  it("leaves other observations to their own gates", () => {
    expect(webAudienceRefused("project.inspect", { kind: "room", roomId: "room-a" })).toBe(false);
  });
});
