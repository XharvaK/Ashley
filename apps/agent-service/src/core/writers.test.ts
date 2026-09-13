import { describe, expect, it } from "vitest";
import { detectOwnerDepartureIntent } from "./writers.js";

describe("detectOwnerDepartureIntent", () => {
  it("accepts direct owner departure statements", () => {
    expect(detectOwnerDepartureIntent("goodnight")).toBe(true);
    expect(detectOwnerDepartureIntent("gn")).toBe(true);
    expect(detectOwnerDepartureIntent("Good night")).toBe(true);
    expect(detectOwnerDepartureIntent("I'm going to bed")).toBe(true);
    expect(detectOwnerDepartureIntent("I'm going to sleep")).toBe(true);
    expect(detectOwnerDepartureIntent("I'll be sleeping")).toBe(true);
    expect(detectOwnerDepartureIntent("I'm going AFK")).toBe(true);
    expect(detectOwnerDepartureIntent("afk")).toBe(true);
    expect(detectOwnerDepartureIntent("brb")).toBe(true);
  });

  it("accepts smart-apostrophe and multi-clause departures", () => {
    expect(detectOwnerDepartureIntent("I’m going to sleep")).toBe(true);
    expect(detectOwnerDepartureIntent("I’ll be sleeping")).toBe(true);
    expect(detectOwnerDepartureIntent("I’m tired, I’ll be sleeping")).toBe(true);
    expect(detectOwnerDepartureIntent("I’m going AFK")).toBe(true);
  });

  it("accepts departure with a trailing question clause", () => {
    expect(
      detectOwnerDepartureIntent("Goodnight, can you keep an eye on things?"),
    ).toBe(true);
    expect(detectOwnerDepartureIntent("I'm going to sleep, okay?")).toBe(true);
    expect(
      detectOwnerDepartureIntent("I’ll be sleeping—anything you need?"),
    ).toBe(true);
  });

  it("rejects negations, interrogatives to others, third-person, and quotes", () => {
    expect(detectOwnerDepartureIntent("I'm not going to sleep")).toBe(false);
    expect(detectOwnerDepartureIntent("I wasn't going to sleep")).toBe(false);
    expect(detectOwnerDepartureIntent("Are you going to sleep?")).toBe(false);
    expect(detectOwnerDepartureIntent("Should I go to sleep?")).toBe(false);
    expect(detectOwnerDepartureIntent("Will she be sleeping?")).toBe(false);
    expect(detectOwnerDepartureIntent("You should go to sleep")).toBe(false);
    expect(detectOwnerDepartureIntent("She is going to sleep")).toBe(false);
    expect(
      detectOwnerDepartureIntent('He said "going to sleep" earlier'),
    ).toBe(false);
    expect(detectOwnerDepartureIntent("sleep is important")).toBe(false);
    expect(detectOwnerDepartureIntent("how was your sleep")).toBe(false);
  });
});
