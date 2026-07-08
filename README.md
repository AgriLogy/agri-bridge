# agri-bridge

HTTP ingest gateway. Translates Router0X-format payloads from field
devices into the Bivocom v1 wire format and forwards to `agri-api`.

```
device → POST :9090/  →  agri-bridge  ┬→ POST :8000/api/v1/bivocom/uplink   (HTTP)
                          (translate)  └→ MQTT agrilogy/{user}/bivocom       (optional)
```

The bridge forwards every accepted uplink over **HTTP** (always) and, when
`MQTT_URL` is set, **also publishes** the same payload over **MQTT** — an
additive second channel that `agri-api`'s `fastapp.mqtt` subscriber consumes.
The MQTT publish is best-effort (fire-and-forget) and never affects the HTTP
`202`/`502` response. Leave `MQTT_URL` unset and the bridge is HTTP-only,
exactly as before.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/` | Legacy device route (Router0X JSON in) |
| POST | `/uplink` | Cleaner alias for `/` |
| GET | `/health` | Liveness — 200 if the process is up |
| GET | `/ready` | Readiness — 200 if backend `/admin/login/` is reachable |

## Wire format — what devices send

```json
{
  "user": "user1",
  "timestamp": "2025-03-15 00:02:08.066",
  "humidity_weather": 70.0,
  "wind_speed": 35.42,
  "soil_moisture_low": 55.0
}
```

- `user`: required; string or number (coerced to string)
- `timestamp`: optional; if omitted the bridge stamps `now()` ISO
- Any other key: required to be a finite number (sensor reading)

The bridge tolerates new sensor keys without code changes.

## Wire format — what the bridge sends to `agri-api`

```json
{
  "device_id": "router-user-user1",
  "timestamp": "2025-03-15 00:02:08.066",
  "tags": {
    "humidity_weather": 70.0,
    "wind_speed": 35.42,
    "soil_moisture_low": 55.0
  }
}
```

Validated by `agri-api`'s pydantic `BivocomUplink` schema.

## Status codes

| Code | When |
|---|---|
| 202 | Valid Router0X payload, backend forwarded successfully (after up to 3 attempts) |
| 400 | Invalid Router0X payload (zod-rejected) |
| 502 | Backend returned 4xx (bug) OR all retry attempts failed (transient) |

## Configuration (env vars)

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `9090` | HTTP bind port |
| `BIND_HOST` | `0.0.0.0` | HTTP bind host |
| `BACKEND_URL` | `http://agri-api-web:8000` | agri-api base URL |
| `BACKEND_PATH` | `/api/v1/bivocom/uplink` | agri-api ingest path |
| `BACKEND_TIMEOUT_MS` | `8000` | per-attempt timeout |
| `RETRY_ATTEMPTS` | `3` | total attempts (1 + 2 retries) |
| `RETRY_BACKOFF_MS` | `100,500,2000` | backoff schedule (ms between retries) |
| `LOG_LEVEL` | `info` | pino log level |
| `MQTT_URL` | _(unset)_ | MQTT broker URL (e.g. `mqtt://mosquitto:1883`). **Unset = MQTT disabled** (HTTP only). |
| `MQTT_USERNAME` | _(unset)_ | MQTT broker username, if the broker requires auth |
| `MQTT_PASSWORD` | _(unset)_ | MQTT broker password |
| `MQTT_TOPIC_PREFIX` | `agrilogy` | publish topic is `{prefix}/{user}/bivocom` |
| `MQTT_QOS` | `1` | publish QoS |

### MQTT channel

When `MQTT_URL` is set, each accepted uplink is also published to
`{MQTT_TOPIC_PREFIX}/{user}/bivocom` with the **same** Bivocom body shown above.
`agri-api`'s `fastapp.mqtt` subscriber (topic `agrilogy/+/bivocom`) derives the
client from the topic and writes the tags through the same ingest handlers the
HTTP webhook uses — so the two channels are interchangeable. In production point
`MQTT_URL` at ChirpStack's broker. Best-effort: MQTT.js queues while the broker
is briefly unreachable; a hard failure is logged and dropped, never failing the
HTTP request. Users containing the topic metacharacters `/ + #` skip the MQTT
channel (HTTP still forwards).

## Tests

```bash
cd Devops/server
npm install
npm test           # vitest, runs unit + integration tests
npm run test:watch
```

Unit tests cover the schema + transform (pure logic). Integration tests
exercise the Express app with a stubbed backend via `vi.spyOn` on `fetch`.

## Notes

- **No file persistence** — the legacy `shared_data/requests.json` was a
  bootstrap hack for when the Django side wasn't ready. Now Postgres (via
  `agri-api`) is the source of truth and the bridge is stateless.
- **No shared-secret auth** yet — a `X-Agri-Token` header check is queued
  for a follow-up PR (will be enforced on both bridge and the
  `/api/v1/bivocom/uplink` endpoint together).
