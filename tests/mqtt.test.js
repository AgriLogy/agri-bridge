/**
 * Unit tests for the MQTT publisher — pure logic + the disabled/no-op path.
 * The real broker round-trip lives in tests/mqtt.e2e.test.js.
 */
import { describe, expect, it } from "vitest";

import { bivocomTopic, createMqttPublisher } from "../src/mqtt.js";

describe("bivocomTopic", () => {
  it("builds {prefix}/{user}/bivocom", () => {
    expect(bivocomTopic("agrilogy", "user1")).toBe("agrilogy/user1/bivocom");
  });

  it("normalizes a trailing slash on the prefix", () => {
    expect(bivocomTopic("agrilogy/", "u2")).toBe("agrilogy/u2/bivocom");
  });
});

describe("createMqttPublisher (disabled)", () => {
  it("returns a no-op publisher when mqttUrl is unset", () => {
    const pub = createMqttPublisher({ mqttUrl: null, logLevel: "silent" });
    expect(pub.enabled).toBe(false);
    // publish + close must be safe no-ops (never throw, never connect)
    expect(() => pub.publish("user1", { tags: {} })).not.toThrow();
    return expect(pub.close()).resolves.toBeUndefined();
  });
});
