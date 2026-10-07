import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../model-routing/types.js";
import { createPrefixMeter } from "./prefix-meter.js";

function user(content: string, imageUrls?: string[]): ChatMessage {
  return imageUrls === undefined ? { role: "user", content } : { role: "user", content, imageUrls };
}

function observePair(before: ChatMessage[], after: ChatMessage[]) {
  const meter = createPrefixMeter();
  expect(meter.observe("chat+owner", before)).toBeNull();
  const report = meter.observe("chat+owner", after);
  expect(report).not.toBeNull();
  return report!;
}

describe("thought prefix meter", () => {
  it("returns null on the first observation and an equal report when the next prompt matches", () => {
    const messages = [user(JSON.stringify({ a: 1 }), ["data:image/png;base64,AAAA"])];
    const meter = createPrefixMeter();
    expect(meter.observe("chat+owner", messages)).toBeNull();
    const report = meter.observe("chat+owner", [user(JSON.stringify({ a: 1 }))]);
    expect(report).not.toBeNull();
    expect(report!.stableBytes).toBe(report!.totalBytes);
    expect(report!.breakPath).toBe("=");
    expect(report!.previousTotalBytes).toBe(report!.totalBytes);
  });

  it("names the system message when the break is inside it", () => {
    const report = observePair(
      [
        { role: "system", content: "alpha" },
        user(JSON.stringify({ z: 1 })),
      ],
      [
        { role: "system", content: "alpha!" },
        user(JSON.stringify({ z: 1 })),
      ],
    );
    expect(report.breakMessage).toBe(0);
    expect(report.breakPath).toBe("system");
    expect(report.stableBytes).toBe(Buffer.byteLength("systemalpha", "utf8"));
  });

  it("names the nested key whose value changed", () => {
    const report = observePair(
      [user(JSON.stringify({ a: { b: { t: 1 } }, z: 2 }))],
      [user(JSON.stringify({ a: { b: { t: 2 } }, z: 2 }))],
    );
    expect(report.breakPath).toBe("a.b.t");
    expect(report.breakMessage).toBe(0);
  });

  it("names an array element with its index", () => {
    const report = observePair(
      [user(JSON.stringify({ items: ["one", "two", "three"] }))],
      [user(JSON.stringify({ items: ["one", "nine", "three"] }))],
    );
    expect(report.breakPath).toBe("items[1]");
  });

  it("names the first key that differs when a key is inserted earlier", () => {
    const report = observePair(
      [user(JSON.stringify({ z: 1, a: 2 }))],
      [user(JSON.stringify({ z: 1, inserted: 0, a: 2 }))],
    );
    expect(report.breakPath).toBe("inserted");
  });

  it("keeps profiles independent and evicts the oldest past the cap", () => {
    const meter = createPrefixMeter(2);
    const msg = (who: string, n: number): ChatMessage[] => [user(JSON.stringify({ who, n }))];
    expect(meter.observe("a", msg("a", 1))).toBeNull();
    expect(meter.observe("b", msg("b", 1))).toBeNull();
    const sameB = meter.observe("b", msg("b", 1));
    expect(sameB?.breakPath).toBe("=");
    expect(sameB?.stableBytes).toBe(sameB?.totalBytes);
    const changedA = meter.observe("a", msg("a", 2));
    expect(changedA?.breakPath).toBe("n");
    expect(meter.observe("c", msg("c", 1))).toBeNull();
    const keptA = meter.observe("a", msg("a", 3));
    expect(keptA?.breakPath).toBe("n");
    expect(meter.observe("b", msg("b", 9))).toBeNull();
  });

  it("never copies a sentinel value into the report", () => {
    const sentinel = "SENTINEL_VALUE_x7k";
    const report = observePair(
      [user(JSON.stringify({ keep: sentinel, n: 1 }))],
      [user(JSON.stringify({ keep: sentinel, n: sentinel }))],
    );
    expect(report.breakPath).toBe("n");
    expect(JSON.stringify(report)).not.toContain(sentinel);
    expect(report.breakPath).not.toContain(sentinel);
  });

  it("counts multibyte characters as UTF-8 bytes", () => {
    const mark = "😀";
    const before = JSON.stringify({ a: mark, b: 1 });
    const after = JSON.stringify({ a: mark, b: 2 });
    const report = observePair([user(before)], [user(after)]);
    const previous = Buffer.from(`user${before}`, "utf8");
    const current = Buffer.from(`user${after}`, "utf8");
    let stable = 0;
    while (stable < previous.length && stable < current.length && previous[stable] === current[stable]) stable += 1;
    expect(report.stableBytes).toBe(stable);
    expect(report.totalBytes).toBe(current.length);
    expect(report.previousTotalBytes).toBe(previous.length);
    const codeUnitPrefix = `user${before.slice(0, before.lastIndexOf("1"))}`.length;
    expect(report.stableBytes).not.toBe(codeUnitPrefix);
    expect(report.breakPath).toBe("b");
  });

  it("cuts a path deeper than six segments", () => {
    const nest = (value: number) => ({ a: { b: { c: { d: { e: { f: { g: value } } } } } } });
    const report = observePair(
      [user(JSON.stringify(nest(1)))],
      [user(JSON.stringify(nest(2)))],
    );
    expect(report.breakPath).toBe("a.b.c.d.e.f");
  });
});
