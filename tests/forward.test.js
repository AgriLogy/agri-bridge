/**
 * forwardToBackend: the X-Ingest-Token header agri-api checks on /ingest/*.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forwardToBackend } from "../src/forward.js";

let fetchSpy;

beforeEach(() => {
  fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("{}", { status: 201 }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

const send = (ingestToken) =>
  forwardToBackend(
    { device_id: "d", tags: { t: 1 } },
    { url: "http://api/ingest/bivocom", backoff: [], ingestToken },
  );

describe("forwardToBackend ingest token", () => {
  it("sends X-Ingest-Token when a token is configured", async () => {
    await send("s3cret");
    const [, opts] = fetchSpy.mock.calls[0];
    expect(opts.headers["X-Ingest-Token"]).toBe("s3cret");
  });

  it("sends no token header when none is configured", async () => {
    await send(null);
    const [, opts] = fetchSpy.mock.calls[0];
    expect(opts.headers).not.toHaveProperty("X-Ingest-Token");
  });

  it("does not retry a 401 (wrong token is permanent)", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 401 }));
    const r = await forwardToBackend(
      { device_id: "d", tags: { t: 1 } },
      { url: "http://api/ingest/bivocom", backoff: [1, 1], ingestToken: "x" },
    );
    expect(r).toMatchObject({ ok: false, status: 401, attempts: 1 });
  });
});
