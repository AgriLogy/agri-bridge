# CLAUDE.md — agri-bridge

Quick-start guide for Claude Code. **Read this in full; everything else is on-demand.**

## What this repo is

The Agrilogy HTTP ingest gateway. A stateless Node.js / Express service that listens on **port 9090**, translates Router0X-format payloads from field devices into the Bivocom v1 wire format, and forwards to `agri-api`'s `/api/v1/bivocom/uplink` endpoint.

No persistence here — Postgres (via agri-api) is the source of truth.

**Tech:** Node 20+ · ESM · Express · zod · pino · vitest

## Sibling repos

| Repo | Path | Role |
|---|---|---|
| `agri-api` | `../agri-api/` | HTTP API service the bridge forwards into. |
| `agri-core` | `../agri-core/` | Framework-agnostic Python shared lib (agronomy handlers etc.). |

## ⚠ Read first

1. **Stateless.** No file or DB writes here. Anything that needs persistence is the receiver's job.
2. **No business logic.** Translation only. Validation lives in `src/schema.js`; transformation in `src/transform.js`; HTTP plumbing in `src/server.js` + `src/forward.js`.
3. **Commit rules:** local machine only (never SSH); no `Co-Authored-By` trailer; every PR pairs with an issue; use the `mks-zakaria` gh account.

## Layout

```
src/
├── server.js      # Express app + routes
├── config.js      # env vars (PORT, BACKEND_URL, BACKEND_PATH, LOG_LEVEL)
├── schema.js      # zod request schemas
├── transform.js   # Router0X → Bivocom payload mapping
└── forward.js     # POST to agri-api with retry / backoff
tests/
├── server.test.js
└── transform.test.js
```

## Quick commands

```bash
npm install            # local deps
npm run dev            # node --watch src/server.js
npm test               # vitest run
```

## Consumed by

agri-api's `docker-compose.yml` builds this service via `context: ../agri-bridge`. The container name is `agri-bridge`. In prod the same image is built from this repo's main branch.
