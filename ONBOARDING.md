# Onboarding — agri-bridge

## What this repo is

`agri-bridge` is a **stateless Node/Express translator** sitting between
the Router0X field devices and the backend:

```
device → POST :9090/ (or /uplink) → agri-bridge → POST agri-api /api/v1/bivocom/uplink
                                     (translate)
```

It accepts Router0X-format JSON, validates it with zod, rewrites it into
the Bivocom v1 wire format (`device_id` + `tags`), and forwards it to
agri-api with retries. No database, no state — see `README.md` for the
wire formats, status codes and endpoint table.

In production it is consumed as a **Docker build context by agri-api's
compose stack** (service on the internal network, published on `:9090`).

## Local setup

```bash
npm ci          # install from the lockfile (Node >= 18, CI uses 20)
npm start       # run the server on :9090
npm run dev     # watch mode
npm test        # vitest run
npm run test:watch
```

Configuration is env-var based with sane defaults (`src/config.js`):
`PORT` (9090), `BACKEND_URL` (`http://agri-api-web:8000`), `BACKEND_PATH`
(`/api/v1/bivocom/uplink`), retry/timeout knobs, optional
`AGRI_BRIDGE_SHARED_SECRET`.

## Contributing rules

- **Conventional commits** — PR titles must be Conventional Commits
  (squash-merge title becomes the commit; CI gates this).
- **PR ↔ issue pairing** — every PR opens with `Closes #N` on a
  dedicated, scope-matched issue; both assigned to `mks-zakaria`.

## CI

All workflows are thin callers into
[`AgriLogy/shared-workflows`](https://github.com/AgriLogy/shared-workflows)
pinned at `@v1`:

- `ci.yml` → `node-test.yml` (npm ci + npm test on Node 20)
- `lint-pr-title.yml`, `auto-assign.yml` → same-named shared workflows
