# agri-bridge onboarding

The short version. [`README.md`](README.md) covers the wire formats and
configuration, and [`CONTRIBUTING.md`](CONTRIBUTING.md) has the full rules.

## What this repo is

The **ingest edge** between field routers and the Agrilogy backend. It is a
stateless Node.js / Express service on port **9090**:

```
Router0X / Bivocom field router
  └─ POST :9090/  (or /uplink)
       │  zod-validated (src/schema.js), translated to Bivocom v1 (src/transform.js)
       ├─ HTTP, always:   POST ${BACKEND_URL}${BACKEND_PATH}
       │                  default http://agri-api-fast:8001/ingest/bivocom
       │                  (retry + backoff in src/forward.js → 202 / 400 / 502)
       └─ MQTT, optional: when MQTT_URL is set, best-effort publish to
                          ${MQTT_TOPIC_PREFIX}/{user}/bivocom, which agri-api's
                          fastapp.mqtt subscriber consumes
```

- It keeps **no state**. Postgres, reached through agri-api, is the source of
  truth. (The old in-repo `requests.json` archive is gone.)
- It is **not published as a package or image**. agri-api's compose file builds
  it as a Docker build context (`context: ../agri-bridge`), so a deploy of
  agri-api picks up whatever this repo's checkout holds.
- LoRaWAN devices don't pass through here: ChirpStack delivers to agri-api
  directly.

## Local setup

You need Node 20 (the Docker image and CI use 20; `engines` allows >=18).

```bash
npm ci
npm test            # vitest: unit + integration (stubbed backend, in-process MQTT broker)
npm run test:watch
npm run dev         # node --watch src/server.js on :9090
```

Point it at a local agri-api with `BACKEND_URL=http://localhost:8001`. Set
`MQTT_URL` only to exercise the MQTT channel. The README lists every env var.

## Contributing

- **Every PR is paired with an issue** (`Closes #N` in the body). Never push to
  `main`: branch, then PR, then squash-merge once CI is green.
- **The PR title is a Conventional Commit** (`feat(transform): ...`,
  `fix(forward): ...`). The squash commit uses the title.
- Payload changes must stay compatible with agri-api's `BivocomUplink` pydantic
  schema. Land the agri-api side first when the contract changes.
- There is no release workflow: agri-api builds from this repo's checkout.

## CI layout

Every workflow is a thin caller of
[`AgriLogy/shared-workflows`](https://github.com/AgriLogy/shared-workflows) `@v1`:

| Workflow | Calls | Notes |
| --- | --- | --- |
| `ci.yml` | `node-test.yml` | `npm ci` + `npm test` on Node 20 from the repo root. |
| `lint-pr-title.yml` | `lint-pr-title.yml` | Conventional Commit PR titles. |
| `auto-assign.yml` | `auto-assign.yml` | Assigns new issues/PRs to `mks-zakaria`. |

To change CI behaviour, change shared-workflows and move its `v1` tag. Only
triggers, permissions and inputs belong in this repo.
