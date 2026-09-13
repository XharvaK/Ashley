import { describe, expect, it, vi } from "vitest";
import {
  FETCH_TIMEOUT_MS,
  MAX_REDIRECTS,
  MAX_RESPONSE_BYTES,
  fetchValidatedResource,
  isPublicAddress,
  validatePublicUrl,
} from "../network.js";

const publicResolve = async () => [{ address: "93.184.216.34", family: 4 }];

describe("curiosity network safety contract", () => {
  it("rejects DNS answers that include a private address", async () => {
    await expect(validatePublicUrl(
      "https://mixed.test/article",
      async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.8", family: 4 },
      ],
    )).rejects.toThrow("non_public_address");
    expect(isPublicAddress("169.254.169.254")).toBe(false);
  });

  it("allows at most five redirects and validates each hop", async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://public.test/next" },
    }));

    await expect(fetchValidatedResource("https://public.test/start", {
      accept: "text/html",
      fetcher,
      resolve: publicResolve,
    })).rejects.toThrow("too_many_redirects");
    expect(fetcher).toHaveBeenCalledTimes(MAX_REDIRECTS + 1);
  });

  it("enforces the two-megabyte body limit and exposes the twenty-second timeout contract", async () => {
    await expect(fetchValidatedResource("https://public.test/large", {
      accept: "text/html",
      resolve: publicResolve,
      fetcher: async () => new Response("small", {
        status: 200,
        headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) },
      }),
    })).rejects.toThrow("response_too_large");
    expect(FETCH_TIMEOUT_MS).toBe(20_000);
  });
});
