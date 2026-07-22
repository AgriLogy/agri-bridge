# Contributing to `agri-bridge`

`agri-bridge` (GitHub: `AgriLogy/agri-bridge`) is the **ingest edge** between field hardware and the
Agrilogy backend. It is a stateless Node.js / Express service: field routers push Router0X-format
JSON over HTTP, the bridge validates + translates it into the **Bivocom v1** wire format and forwards
it to `agri-api`. Nothing is persisted here — Postgres, reached through `agri-api`, is the source of truth.

**Tech:** Node 20 (Docker) / >=18 (`package.json` engines) · ESM · Express 4 · zod · pino · vitest.

## Request path (verified against `src/`)

```
Bivocom / Router0X field router
  └─ POST http://<bridge-host>:9090/         (or /uplink — same handler, src/server.js)
       │  zod-validated by src/schema.js, mapped by src/transform.js
       ├─ HTTP (always)  POST ${BACKEND_URL}${BACKEND_PATH}
       │                 default → http://agri-api-web:8000/api/v1/bivocom/uplink
       │                 retry/backoff in src/forward.js → 202 / 400 / 502
       └─ MQTT (only when MQTT_URL is set, best-effort, fire-and-forget)
                         topic ${MQTT_TOPIC_PREFIX}/{user}/bivocom  (default prefix `agrilogy`)
                         consumed by agri-api's `fastapp.mqtt` subscriber (`agrilogy/+/bivocom`)
```

LoRaWAN devices do **not** transit this repo's code paths: ChirpStack delivers them to `agri-api`
directly (HTTP integration or its MQTT broker). The bridge's only role for LoRaWAN is that in
production `MQTT_URL` can point at the ChirpStack broker so both channels share one bus.

| Route | Method | Behaviour (`src/server.js`) |
|---|---|---|
| `/` | POST | Legacy device route — Router0X JSON in |
| `/uplink` | POST | Alias, identical handler |
| `/health` | GET | Liveness — always `200 {"status":"ok"}` |
| `/ready` | GET | Readiness — GETs `${BACKEND_URL}/admin/login/` (2s timeout); `200` if `<500`, else `503` |

| Status | When |
|---|---|
| `202` | Valid payload, backend accepted (≤ `RETRY_ATTEMPTS` attempts) |
| `400` | zod rejected the Router0X payload (`error.code = validation_error`) |
| `502` | Backend 4xx (permanent, no retry) or retries exhausted (`error.code = backend_unavailable`) |

## Prerequisites & first-time setup

- Node 20+ and npm (Docker image is `node:20-slim`).
- Optional: a running `agri-api` (sibling checkout `../agri-api/`) if you want real forwarding.
- No `.env` file is read by the code — configuration is pure `process.env` (`src/config.js`).

```bash
git clone https://github.com/AgriLogy/agri-bridge.git
cd agri-bridge
npm install
npm test
```

## Environment variables (all from `src/config.js`)

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `9090` | HTTP bind port |
| `BIND_HOST` | `0.0.0.0` | HTTP bind host |
| `BACKEND_URL` | `http://agri-api-web:8000` | `agri-api` base URL |
| `BACKEND_PATH` | `/api/v1/bivocom/uplink` | ingest path on `agri-api` |
| `BACKEND_TIMEOUT_MS` | `8000` | per-attempt timeout |
| `RETRY_ATTEMPTS` | `3` | total attempts (1 + 2 retries) |
| `RETRY_BACKOFF_MS` | `100,500,2000` | comma-separated backoff schedule |
| `LOG_LEVEL` | `info` | pino level |
| `AGRI_BRIDGE_SHARED_SECRET` | _(unset)_ | parsed but **not yet enforced** — auth is a follow-up |
| `MQTT_URL` | _(unset)_ | e.g. `mqtt://mosquitto:1883`; unset ⇒ MQTT disabled (HTTP only) |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | _(unset)_ | broker auth |
| `MQTT_TOPIC_PREFIX` | `agrilogy` | topic is `{prefix}/{user}/bivocom` |
| `MQTT_QOS` | `1` | publish QoS |

## Running locally

```bash
# Point at a local agri-api and start with hot reload
BACKEND_URL=http://localhost:8000 LOG_LEVEL=debug npm run dev

# Production-style start
npm start
```

Docker (this repo has no `docker-compose.yml`; the service is composed from `agri-api`):

```bash
docker build -t agri-bridge .
docker run --rm -p 9090:9090 \
  -e BACKEND_URL=http://host.docker.internal:8000 \
  -e LOG_LEVEL=debug agri-bridge

# Or, from the sibling agri-api checkout (build context ../agri-bridge):
cd ../agri-api && docker compose up -d agri-bridge
```

## Dev loop — exact npm scripts

| Command | What it does |
|---|---|
| `npm run dev` | `node --watch src/server.js` |
| `npm start` | `node src/server.js` |
| `npm test` | `vitest run` (unit + integration + MQTT e2e against in-process `aedes`) |
| `npm run test:watch` | `vitest` |

There is **no lint or format script** in `package.json` — CI runs `npm ci` + `npm test` only.

## `src/` layout

| File | Responsibility |
|---|---|
| `src/server.js` | Express app factory `createApp({ publisher })`, routes, ingest handler, graceful shutdown |
| `src/config.js` | Frozen env-derived config, read **once** at module load |
| `src/schema.js` | zod `router0xPayload` — `user` (string\|number→string), optional `timestamp`, `.catchall(finiteNumber)` |
| `src/transform.js` | Pure `toBivocomUplink()` — `user → device_id = router-user-${user}`, every finite number → `tags` |
| `src/forward.js` | `forwardToBackend()` — timeout, transient set `{408,429,500,502,503,504}`, backoff retries |
| `src/mqtt.js` | `createMqttPublisher()` + `bivocomTopic()`; no-op publisher when `MQTT_URL` unset |
| `tests/` | `transform.test.js` (pure), `server.test.js` (supertest + `vi.spyOn(fetch)`), `mqtt.test.js`, `mqtt.e2e.test.js` |

**Where a new device / payload format handler goes:** a new *shape* gets its own zod schema in
`src/schema.js` and its own pure mapper in `src/transform.js`; wire it to a new route (or branch
inside `ingestHandler`) in `src/server.js`. Never put I/O, logging or state in the transform — it must
stay a pure function so it can be tested in isolation. `src/forward.js` and `src/mqtt.js` are
format-agnostic and normally need no change: they carry whatever Bivocom body you produce.

## Worked example — supporting a new router payload

1. **Schema** — add to `src/schema.js`:
   ```js
   export const router1xPayload = z.object({
     device: z.string().min(1),
     ts: z.string().min(1).optional(),
   }).catchall(z.number().finite());
   ```
2. **Transform** — add a pure mapper in `src/transform.js` that emits the shape `agri-api` expects,
   i.e. exactly `{ device_id: string, timestamp: string, tags: Record<string, number> }` — validated
   server-side by `agri-api`'s pydantic `BivocomUplink` schema. Reserved keys must not leak into `tags`.
3. **Route** — in `src/server.js`, add `app.post("/uplink/router1x", handler)` reusing
   `forwardToBackend(...)` and `pub.publish(user, bivocom)` (MQTT publish is skipped for users
   containing `/ + #`).
4. **Test with a captured sample** — mirror `tests/transform.test.js` (pure mapping assertions,
   including "reserved keys must not appear in tags" and the non-finite drop case) and
   `tests/server.test.js` (supertest against `createApp()` with `vi.spyOn(globalThis, "fetch")`
   asserting the exact JSON body posted to the backend).
5. `npm test` must be green before opening the PR.

## Testing an uplink locally

Body below is the fixture used in `tests/transform.test.js`.

```bash
npm run dev &   # bridge on :9090

curl -i -X POST http://localhost:9090/uplink \
  -H 'Content-Type: application/json' \
  -d '{
        "user": "user1",
        "timestamp": "2025-03-15 00:02:08.066",
        "precipitation_rate": 15,
        "humidity_weather": 70.0,
        "wind_speed": 35.42,
        "solar_radiation": 420.25,
        "pressure_weather": 900.09
      }'
# → 202 {"accepted":true,"device_id":"router-user-user1","tag_count":5,...}

curl -s http://localhost:9090/health   # {"status":"ok"}
curl -s http://localhost:9090/ready    # 503 unless BACKEND_URL/admin/login/ answers

# 400 path (non-numeric sensor value)
curl -i -X POST http://localhost:9090/ \
  -H 'Content-Type: application/json' \
  -d '{"user":"","broken":"not a number"}'
```

The backend receives `{"device_id":"router-user-user1","timestamp":"2025-03-15 00:02:08.066","tags":{...}}`.

## Branch & PR rules

- Branch off **`main`** (`feat/…`, `fix/…`, `chore/…`). Never commit directly to `main`.
- **Conventional Commits** PR titles — enforced by `.github/workflows/lint-pr-title.yml`
  (`amannn/action-semantic-pull-request`, allowed types: `feat fix perf refactor docs style test build
  ci chore revert`; subject must start with a letter). Squash-merge uses the PR title as the commit message.
- Every PR pairs with **one dedicated, scope-matched issue** and the PR body contains `Closes #N`.
- Issue and PR are both assigned to **mks-zakaria** — `.github/workflows/auto-assign.yml` does this
  automatically on `opened`.
- **Zero AI/assistant attribution** anywhere: no `Co-Authored-By` trailer, no Claude/AI mention in
  commits, branches, PR titles/bodies or issues.
- Commit from a local machine only — never over SSH on the droplet.

## CI & deployment

- **CI** (`.github/workflows/ci.yml`): on every PR and on push to `main` — Node 20, `npm ci`, `npm test`.
  No lint/build job exists.
- **Image**: multi-stage `Dockerfile` — `node:20-slim` deps stage (`npm ci --omit=dev`) → runtime stage
  copying `node_modules`, `package.json`, `src/`; `NODE_ENV=production`, `PORT=9090`, `EXPOSE 9090`,
  runs as the non-root `node` user, `CMD ["node", "src/server.js"]`.
- **Deployment**: the service is composed from the sibling `agri-api` repo — `docker-compose.yml`
  builds `context: ../agri-bridge`, `container_name: agri-bridge`, publishes `9090:9090`, sets
  `PORT/BACKEND_URL/BACKEND_PATH/LOG_LEVEL`, and `depends_on: agri-api-web (service_healthy)`.
  There is **no release/publish workflow in this repo** — no semantic-release, no registry push.

## Gotchas

- **Stateless.** No file or DB writes. The old `shared_data/requests.json` flat file is gone; anything
  needing persistence is `agri-api`'s job.
- **No business logic.** Translation only — validation in `schema.js`, mapping in `transform.js`,
  plumbing in `server.js` / `forward.js`.
- **Config is read once** at module load; don't re-read `process.env` per request. Tests that need
  different config inject it (`createMqttPublisher(cfg)`) or use `createApp({ publisher })`.
- **MQTT is additive and best-effort** — it never awaits and never changes the `202`/`502` contract.
  Users containing `/`, `+` or `#` skip MQTT entirely (HTTP still forwards).
- **`4xx` from the backend is not retried** — it means our transform produced an invalid payload; the
  bridge still answers `502` so the bug is visible.
- **`AGRI_BRIDGE_SHARED_SECRET` / `X-Agri-Token` auth is not implemented yet** — it must land on the
  bridge and on `agri-api`'s `/api/v1/bivocom/uplink` in the same change.
- **Stale doc**: `README.md`'s test snippet still says `cd Devops/server` — that path no longer exists;
  run npm from the repo root.
- `.claude/COMMON_MISTAKES.md`, `QUICK_START.md` and `ARCHITECTURE_MAP.md` are unfilled templates
  (and `.claude/` is gitignored) — no repo knowledge there yet.
