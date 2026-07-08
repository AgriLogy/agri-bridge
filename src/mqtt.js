/**
 * MQTT publisher — an ADDITIONAL delivery channel for translated Bivocom
 * uplinks, alongside the existing HTTP forward (src/forward.js).
 *
 * Each accepted uplink is published to `${prefix}/${user}/bivocom` with the
 * SAME `{device_id, timestamp, tags}` body the HTTP path posts. agri-api's
 * `fastapp.mqtt` subscriber listens on `agrilogy/+/bivocom`, derives the client
 * (username) from the topic, and writes the tags through the same ingest
 * handlers the HTTP webhook uses — so the two channels are interchangeable.
 *
 * Best-effort by design: `publish()` never throws and never blocks the HTTP
 * response. MQTT.js queues messages while the broker is briefly unreachable and
 * flushes them on reconnect; a hard failure is logged and dropped. When
 * `config.mqttUrl` is unset the factory returns a no-op publisher, so the
 * bridge runs HTTP-only exactly as before (zero behaviour change).
 *
 * ⚠️ `user` becomes an MQTT topic level, so it must not contain the topic
 * metacharacters `/ + #` (they would corrupt the subscriber's `topic.split`
 * client extraction). Such uplinks skip the MQTT channel (HTTP still forwards).
 */
import mqtt from "mqtt";
import pino from "pino";

import { config } from "./config.js";

/** Topic levels can't contain the MQTT wildcards/separator. */
const TOPIC_UNSAFE = /[/+#]/;

/**
 * Build the publish topic for a client (username).
 * @param {string} prefix
 * @param {string} user
 * @returns {string}
 */
export function bivocomTopic(prefix, user) {
  return `${prefix.replace(/\/+$/, "")}/${user}/bivocom`;
}

/** A publisher that does nothing — used when MQTT is not configured. */
function noopPublisher() {
  return {
    enabled: false,
    publish() {},
    async close() {},
  };
}

/**
 * Create the MQTT publisher from config (or an injected config, for tests).
 *
 * @param {typeof config} [cfg]
 * @param {import("pino").Logger} [logger]
 * @returns {{enabled: boolean, publish: (user: string, payload: object) => void, close: () => Promise<void>}}
 */
export function createMqttPublisher(cfg = config, logger) {
  const log = logger ?? pino({ level: cfg.logLevel ?? "info" });

  if (!cfg.mqttUrl) {
    log.info("mqtt.disabled — MQTT_URL not set; publishing over HTTP only.");
    return noopPublisher();
  }

  const client = mqtt.connect(cfg.mqttUrl, {
    username: cfg.mqttUsername ?? undefined,
    password: cfg.mqttPassword ?? undefined,
    reconnectPeriod: 2000,
    connectTimeout: 10_000,
    // Keep our own client id stable-ish but unique per process.
    clientId: `agri-bridge-${Math.random().toString(16).slice(2, 10)}`,
  });

  client.on("connect", () => log.info({ url: cfg.mqttUrl }, "mqtt.connected"));
  client.on("reconnect", () => log.warn("mqtt.reconnecting"));
  client.on("error", (err) => log.warn({ err: err?.message }, "mqtt.error"));

  const qos = Number.isFinite(cfg.mqttQos) ? cfg.mqttQos : 1;
  const prefix = cfg.mqttTopicPrefix ?? "agrilogy";

  return {
    enabled: true,

    /**
     * Publish a translated Bivocom payload for `user`. Fire-and-forget:
     * resolves synchronously, never throws.
     */
    publish(user, payload) {
      if (typeof user !== "string" || user.length === 0 || TOPIC_UNSAFE.test(user)) {
        log.warn({ user }, "mqtt.publish_skipped_unsafe_user");
        return;
      }
      const topic = bivocomTopic(prefix, user);
      client.publish(topic, JSON.stringify(payload), { qos }, (err) => {
        if (err) {
          log.warn({ topic, err: err?.message }, "mqtt.publish_failed");
        } else {
          log.debug({ topic }, "mqtt.published");
        }
      });
    },

    /** Flush + close the client (call on shutdown). */
    async close() {
      await new Promise((resolve) => client.end(false, {}, resolve));
    },
  };
}
