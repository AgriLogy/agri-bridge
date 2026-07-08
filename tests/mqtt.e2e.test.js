/**
 * End-to-end: the MQTT publisher against a REAL broker (in-process `aedes`).
 *
 * Proves the actual publish crosses a socket to the right topic with the right
 * body — and that POST /uplink fans out to BOTH the HTTP forward (mocked) and
 * the MQTT channel. This is the bridge-side mirror of agri-api's mqtt e2e; the
 * two together verify the full Router0X → bridge → MQTT → agri-api path.
 */
import net from "node:net";

import Aedes from "aedes";
import mqtt from "mqtt";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createMqttPublisher } from "../src/mqtt.js";
import { createApp } from "../src/server.js";

let broker;
let server;
let url;

beforeAll(async () => {
  broker = new Aedes();
  server = net.createServer(broker.handle);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `mqtt://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => broker.close(resolve));
});

/** Subscribe and collect messages; returns {client, messages, ready}. */
function subscribe(topic) {
  const messages = [];
  const client = mqtt.connect(url);
  const ready = new Promise((resolve, reject) => {
    client.on("connect", () =>
      client.subscribe(topic, { qos: 1 }, (err) => (err ? reject(err) : resolve()))
    );
    client.on("error", reject);
  });
  client.on("message", (t, payload) =>
    messages.push({ topic: t, body: JSON.parse(payload.toString()) })
  );
  return { client, messages, ready };
}

async function waitFor(pred, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return pred();
}

const mkPublisher = () =>
  createMqttPublisher({
    mqttUrl: url,
    mqttTopicPrefix: "agrilogy",
    mqttQos: 1,
    logLevel: "silent",
  });

describe("MQTT publisher (real broker)", () => {
  it("publishes the bivocom payload to {prefix}/{user}/bivocom", async () => {
    const sub = subscribe("agrilogy/+/bivocom");
    await sub.ready;
    const pub = mkPublisher();
    const payload = {
      device_id: "router-user-user1",
      timestamp: "2026-05-28T11:00:00Z",
      tags: { temperature_weather: 21.5, humidity_weather: 63 },
    };

    pub.publish("user1", payload);

    expect(await waitFor(() => sub.messages.length > 0)).toBe(true);
    expect(sub.messages[0].topic).toBe("agrilogy/user1/bivocom");
    expect(sub.messages[0].body).toEqual(payload);

    await pub.close();
    sub.client.end();
  });

  it("skips users with topic metacharacters, still delivers safe ones", async () => {
    const sub = subscribe("agrilogy/#");
    await sub.ready;
    const pub = mkPublisher();

    pub.publish("a/b+c", { device_id: "x", timestamp: "t", tags: { temp: 1 } });
    pub.publish("gooduser", { device_id: "y", timestamp: "t", tags: { temp: 2 } });

    // The safe one lands...
    expect(
      await waitFor(() =>
        sub.messages.some((m) => m.topic === "agrilogy/gooduser/bivocom")
      )
    ).toBe(true);
    // ...and the unsafe one produced nothing.
    expect(sub.messages.every((m) => !m.topic.includes("a/b"))).toBe(true);

    await pub.close();
    sub.client.end();
  });
});

describe("POST /uplink — dual publish (HTTP + MQTT)", () => {
  it("forwards over HTTP AND publishes the same payload over MQTT", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ accepted: true }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      })
    );
    const sub = subscribe("agrilogy/+/bivocom");
    await sub.ready;
    const publisher = mkPublisher();
    const app = createApp({ publisher });

    const res = await request(app).post("/uplink").send({
      user: "u1",
      humidity_weather: 70,
      wind_speed: 35.42,
      timestamp: "2026-05-28T11:00:00Z",
    });

    // HTTP path unchanged: 202 + backend called once.
    expect(res.status).toBe(202);
    expect(fetchSpy).toHaveBeenCalledOnce();

    // MQTT channel delivered the same transformed payload.
    expect(await waitFor(() => sub.messages.length > 0)).toBe(true);
    expect(sub.messages[0].topic).toBe("agrilogy/u1/bivocom");
    expect(sub.messages[0].body.device_id).toBe("router-user-u1");
    expect(sub.messages[0].body.tags).toEqual({
      humidity_weather: 70,
      wind_speed: 35.42,
    });

    await publisher.close();
    sub.client.end();
    vi.restoreAllMocks();
  });

  it("still returns 202 over HTTP even if MQTT is disabled", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ accepted: true }), { status: 202 })
    );
    const publisher = createMqttPublisher({ mqttUrl: null, logLevel: "silent" });
    const app = createApp({ publisher });

    const res = await request(app).post("/uplink").send({ user: "u1", temp: 23 });
    expect(res.status).toBe(202);
    vi.restoreAllMocks();
  });
});
