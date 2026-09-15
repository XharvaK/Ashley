import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { openNuclearDb } from "../db.js";
import {
  fetchWithAggregateLimits,
  MAX_AGGREGATE_PAGES,
  MAX_AGGREGATE_SUBREQUESTS,
} from "../curiosity/network.js";
import {
  createPendingRead,
  fetchConversationalReadPage,
  markConversationalReadIncluded,
} from "./conversational-read.js";

const resolvePublic = async () => [{ address: "93.184.216.34", family: 4 }];

function longPage(label: string): string {
  return `<html><title>${label}</title><body>${
    `${label} is bounded external evidence. `.repeat(8)
  }</body></html>`;
}

function requestPath(input: RequestInfo | URL): string {
  const value = input instanceof URL
    ? input.toString()
    : input instanceof Request
      ? input.url
      : input;
  return new URL(value).pathname;
}

describe("bounded external-read aggregate envelope", () => {
  it("stops page and subrequest fan-out at finite limits", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => new Response(longPage(requestPath(input)), {
      status: 200,
      headers: { "content-type": "text/html" },
    }));

    const result = await fetchWithAggregateLimits([
      "https://public.test/one",
      "https://public.test/two",
      "https://public.test/three",
    ], {
      accept: "text/html",
      timeoutMs: 2_000,
      maxPages: 2,
      maxSubrequests: 2,
      fetcher,
      resolve: resolvePublic,
    });

    expect(MAX_AGGREGATE_PAGES).toBeGreaterThan(0);
    expect(MAX_AGGREGATE_SUBREQUESTS).toBeGreaterThan(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.pages).toHaveLength(2);
    expect(result.envelope.totalPages).toBe(2);
    expect(result.envelope.fanOut).toBe(2);
    expect(result.envelope.subrequests).toBe(2);
    expect(result.envelope.truncated).toBe(true);
    expect(result.envelope.incomplete).toBe(true);
    expect(result.envelope.truncationMarker).toContain("truncated");
  });

  it("marks a response-byte cap instead of silently cutting it", async () => {
    const result = await fetchWithAggregateLimits(["https://public.test/bytes"], {
      accept: "text/plain",
      timeoutMs: 2_000,
      maxPages: 1,
      maxBytes: 10,
      fetcher: async () => new Response("0123456789ABCDEFGHIJ", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
      resolve: resolvePublic,
    });

    expect(new TextDecoder().decode(result.pages[0]?.body)).toBe("0123456789");
    expect(result.envelope.totalBytes).toBe(10);
    expect(result.envelope.truncated).toBe(true);
    expect(result.envelope.incomplete).toBe(true);
    expect(result.envelope.truncationMarker).toContain("truncated");
  });

  it("counts redirect subrequests inside the aggregate budget", async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://public.test/next" },
    }));

    const result = await fetchWithAggregateLimits(["https://public.test/start"], {
      accept: "text/html",
      timeoutMs: 2_000,
      maxPages: 1,
      maxRedirects: 1,
      maxSubrequests: 2,
      fetcher,
      resolve: resolvePublic,
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.pages).toHaveLength(0);
    expect(result.envelope.redirectDepth).toBe(1);
    expect(result.envelope.subrequests).toBe(2);
    expect(result.envelope.truncated).toBe(true);
    expect(result.envelope.incomplete).toBe(true);
  });

  it("round-trips citation and provenance facets through a conversational read", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const ownerId = "owner-aggregate";
    const pending = createPendingRead(db, {
      ownerId,
      url: "https://public.test/one",
      sourceMessageEntityUuid: "message-aggregate",
      deliveryReservationEntityUuid: "reservation-aggregate",
    });
    expect(pending).not.toBeNull();

    const fetched = await fetchConversationalReadPage(db, {
      ownerId,
      entityUuid: pending!.entityUuid,
      url: pending!.requestedUrl,
      urls: ["https://public.test/two"],
      timeoutMs: 2_000,
      fetcher: async (input: RequestInfo | URL) => new Response(longPage(requestPath(input)), {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
      resolve: resolvePublic,
    });

    expect(fetched).not.toBeNull();
    expect(fetched!.provenance).toHaveLength(2);
    expect(fetched!.provenance[0]!.sourceIdentity).toMatch(/^url:/);
    expect(fetched!.provenance[0]!.evidenceIdentity).toMatch(/^sha256:/);
    expect(fetched!.provenance[0]!.capturedAt).toMatch(/T/);
    expect(fetched!.provenance[0]!.citationRefs[0]).toContain(
      `conversational-read:${pending!.entityUuid}:page:0`,
    );
    expect(fetched!.provenance[0]!.completeness).toBe("complete");
    expect(fetched!.modelExcerpt).toContain("external evidence");
    expect(fetched!.modelParts).toHaveLength(2);

    expect(markConversationalReadIncluded(
      db,
      pending!.entityUuid,
      ownerId,
      fetched!.modelParts,
    )).toBe(true);
    const row = db.prepare(
      `SELECT status, model_parts_json FROM conversational_reads WHERE entity_uuid = ?`,
    ).get(pending!.entityUuid) as { status: string; model_parts_json: string };
    expect(row.status).toBe("included");
    expect(JSON.parse(row.model_parts_json)[0].provenance.citationRefs[0]).toContain(
      `conversational-read:${pending!.entityUuid}:page:0`,
    );
  });
});
