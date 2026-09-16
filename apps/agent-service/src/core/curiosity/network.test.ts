import { describe, expect, it, vi } from "vitest";

type MockLookupCallback = (
  error: Error | null,
  address?: string | Array<{ address: string; family: number }>,
  family?: number,
) => void;

type MockConnect = {
  lookup: (
    hostname: string,
    options: { all?: boolean; family?: number },
    callback: MockLookupCallback,
  ) => void;
  servername?: string;
};

type MockAgentRecord = {
  connect: MockConnect;
  closeCalls: number;
  destroyCalls: number;
};

const undiciHarness = vi.hoisted(() => ({
  agents: [] as MockAgentRecord[],
  fetch: vi.fn(),
}));

vi.mock("undici", () => {
  class MockAgent {
    readonly connect: MockConnect;
    private readonly record: MockAgentRecord;

    constructor(options: { connect: MockConnect }) {
      this.connect = options.connect;
      this.record = {
        connect: options.connect,
        closeCalls: 0,
        destroyCalls: 0,
      };
      undiciHarness.agents.push(this.record);
    }

    close(): Promise<void> {
      this.record.closeCalls += 1;
      return Promise.resolve();
    }

    destroy(): void {
      this.record.destroyCalls += 1;
    }
  }

  return { Agent: MockAgent, fetch: undiciHarness.fetch };
});

import {
  FETCH_TIMEOUT_MS,
  MAX_REDIRECTS,
  fetchValidatedResource,
  isPublicAddress,
  validatePublicUrl,
} from "./network.js";

describe("curiosity network boundary", () => {
  it("rejects private, loopback, link-local, reserved, and metadata addresses", async () => {
    for (const address of [
      "127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1",
      "198.51.100.1", "::1", "fe80::1", "fc00::1", "2001:db8::1",
      "::ffff:7f00:1", "::ffff:10.0.0.1", "64:ff9b::a00:1",
      "64:ff9b:1::1", "100::1", "2001:2::1", "2001:10::1",
      "2001::1", "2002:7f00:1::",
    ]) {
      expect(isPublicAddress(address)).toBe(false);
    }
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
    expect(isPublicAddress("64:ff9b::808:808")).toBe(true);
    await expect(validatePublicUrl("http://internal.test/x", async () => [
      { address: "10.1.2.3", family: 4 },
    ])).rejects.toThrow("non_public_address");
  });

  it("revalidates every redirect before fetching it", async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "http://169.254.169.254/latest/meta-data" },
    }));
    await expect(fetchValidatedResource("https://public.test/start", {
      accept: "text/html",
      fetcher,
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    })).rejects.toThrow("non_public_address");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("pins the production dispatcher lookup to the validated address set", async () => {
    undiciHarness.agents.length = 0;
    undiciHarness.fetch.mockReset();
    undiciHarness.fetch.mockImplementation(async (_input: unknown, init: unknown) => {
      const dispatcher = (init as { dispatcher: { connect: MockConnect } }).dispatcher;
      const connect = dispatcher.connect;
      const lookupResult = await new Promise<{ address: string; family: number }>((resolve, reject) => {
        connect.lookup("public.test", { all: false }, (error, address, family) => {
          if (error || typeof address !== "string" || family === undefined) {
            reject(error ?? new Error("lookup_not_pinned"));
            return;
          }
          resolve({ address, family });
        });
      });
      expect(lookupResult).toEqual({ address: "93.184.216.34", family: 4 });
      expect(lookupResult.address).not.toBe("public.test");
      return new Response("pinned", { status: 200 });
    });

    const resolve = vi.fn(async () => [
      { address: "93.184.216.34", family: 4 },
    ]);
    const result = await fetchValidatedResource("https://public.test/article", {
      accept: "text/html",
      resolve,
    });

    expect(new TextDecoder().decode(result.body)).toBe("pinned");
    expect(resolve).toHaveBeenCalledOnce();
    expect(undiciHarness.fetch).toHaveBeenCalledOnce();
    expect(undiciHarness.agents).toHaveLength(1);
    expect(undiciHarness.agents[0]!.connect.servername).toBe("public.test");
    expect(undiciHarness.agents[0]!.closeCalls).toBe(1);
    expect(undiciHarness.agents[0]!.destroyCalls).toBe(0);
  });

  it("cancels redirect bodies before following the next location", async () => {
    const cancel = vi.fn(async () => undefined);
    const stream = new ReadableStream({ cancel });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(stream, {
        status: 302,
        headers: { location: "https://next.test/article" },
      }))
      .mockResolvedValueOnce(new Response("article", { status: 200 }));
    await fetchValidatedResource("https://public.test/start", {
      accept: "text/html",
      fetcher,
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("stops after the bounded redirect budget", async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://next.test/article" },
    }));
    await expect(fetchValidatedResource("https://public.test/start", {
      accept: "text/html",
      fetcher,
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    })).rejects.toThrow("too_many_redirects");
    expect(fetcher).toHaveBeenCalledTimes(MAX_REDIRECTS + 1);
  });

  it("enforces the two-megabyte response boundary", async () => {
    await expect(fetchValidatedResource("https://public.test/large", {
      accept: "text/html",
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      fetcher: async () => new Response("small", {
        status: 200,
        headers: { "content-length": String(2 * 1024 * 1024 + 1) },
      }),
    })).rejects.toThrow("response_too_large");
  });

  it("applies the total timeout to DNS resolution", async () => {
    vi.useFakeTimers();
    try {
      const pending = fetchValidatedResource("https://never-resolves.test/article", {
        accept: "text/html",
        resolve: async () => await new Promise(() => undefined),
      });
      const rejection = expect(pending).rejects.toThrow("fetch_timeout");
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});
