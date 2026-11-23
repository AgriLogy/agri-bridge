/**
 * Integration tests for the Express app — stubbed backend via fetch mock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import pino from "pino";

import { createApp } from "../src/server.js";

let fetchSpy;

beforeEach(() => {
  // Default: backend returns 202 with the bivocom response
  fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({ accepted: true, device_id: "router-user-u1", tag_count: 3 }),
      { status: 202, headers: { "Content-Type": "application/json" } }
    )
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /health", () => {
  it("returns 200 always", async () => {
    const res = await request(createApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("POST / (Router0X ingest)", () => {
  it("accepts a valid payload and returns 202 + backend metadata", async () => {
    const res = await request(createApp())
      .post("/")
      .send({
        user: "u1",
        humidity_weather: 70.0,
        wind_speed: 35.42,
        timestamp: "2026-05-28T11:00:00Z",
      });
    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(true);
    expect(res.body.device_id).toBe("router-user-u1");
    expect(res.body.tag_count).toBe(2);
    expect(res.body.attempts).toBe(1);
    // Backend was called with the transformed payload
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, opts] = fetchSpy.mock.calls[0];
    const sent = JSON.parse(opts.body);
    expect(sent.device_id).toBe("router-user-u1");
    expect(sent.tags.humidity_weather).toBe(70.0);
  });

  it("returns 400 on invalid Router0X payload", async () => {
    const res = await request(createApp())
      .post("/")
      .send({ user: "", broken: "not a number" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 502 when backend persistently 500s", async () => {
    fetchSpy.mockResolvedValue(
      new Response("oops", { status: 500 })
    );
    const res = await request(createApp())
      .post("/")
      .send({ user: "u1", temp: 23 });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("backend_unavailable");
    // Default retry policy: 1 + 2 retries (backoff 100/500) = 3 attempts
    expect(res.body.error.attempts).toBeGreaterThanOrEqual(2);
  });

  it("returns 502 (no retry) when backend 4xx", async () => {
    fetchSpy.mockResolvedValue(
      new Response('{"error":"bad"}', { status: 400 })
    );
    const res = await request(createApp())
      .post("/")
      .send({ user: "u1", temp: 23 });
    expect(res.status).toBe(502);
    expect(res.body.error.attempts).toBe(1); // 4xx is permanent, no retry
  });
});

describe("POST /uplink (alias)", () => {
  it("works the same as POST /", async () => {
    const res = await request(createApp())
      .post("/uplink")
      .send({ user: "u1", temp: 23 });
    expect(res.status).toBe(202);
  });
});

describe("body tracing in logs", () => {
  /** Build an app whose pino logger writes JSON lines into `lines`. */
  function tracedApp(traceConfig) {
    const lines = [];
    const logger = pino({ level: "info" }, { write: (s) => lines.push(JSON.parse(s)) });
    const app = createApp({ logger, traceConfig });
    return { app, find: (msg) => lines.find((l) => l.msg === msg) };
  }

  it("logs the received body when the payload is rejected", async () => {
    const { app, find } = tracedApp({ logBodyMaxChars: 2048, logBodies: false });
    const res = await request(app).post("/").send({ client: "abc", temp: 21.5 });
    expect(res.status).toBe(400);
    expect(find("router0x.invalid").body).toBe('{"client":"abc","temp":21.5}');
  });

  it("logs raw text and returns a JSON 400 on malformed JSON", async () => {
    const { app, find } = tracedApp({ logBodyMaxChars: 2048, logBodies: false });
    const res = await request(app)
      .post("/")
      .set("Content-Type", "application/json")
      .send('{"user":"Router01",');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("malformed_json");
    expect(find("router0x.malformed_json").body).toBe('{"user":"Router01",');
  });

  it("omits the body when LOG_BODY_MAX_CHARS is 0", async () => {
    const { app, find } = tracedApp({ logBodyMaxChars: 0, logBodies: false });
    await request(app).post("/").send({ client: "abc" });
    expect(find("router0x.invalid").body).toBeNull();
  });

  it("logs accepted bodies only when LOG_BODIES is on", async () => {
    const payload = { user: "Router01", temp: 21.5 };
    const off = tracedApp({ logBodyMaxChars: 2048, logBodies: false });
    await request(off.app).post("/").send(payload);
    expect(off.find("router0x.accepted").body).toBeUndefined();

    const on = tracedApp({ logBodyMaxChars: 2048, logBodies: true });
    await request(on.app).post("/").send(payload);
    expect(on.find("router0x.accepted").body).toBe(JSON.stringify(payload));
  });
});
