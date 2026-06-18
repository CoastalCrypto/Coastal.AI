# Contributing to Coastal.AI

Thanks for your interest. Here's everything you need to get started.

## Development setup

```bash
git clone https://github.com/CoastalCrypto/Coastal.AI.git
cd Coastal.AI
pnpm install
pnpm build
```

Start the dev server:
```bash
pnpm --filter @coastal-ai/core dev   # API on :4747
pnpm --filter web dev                  # UI on :5173
```

## Running tests

```bash
pnpm test                      # all packages
pnpm --filter @coastal-ai/core test  # core only
bash scripts/smoke-test-docker.sh      # end-to-end Docker smoke test
```

## Project structure

| Package | Purpose |
|---|---|
| `packages/core` | Fastify API server, agent loop, LLM router, persona |
| `packages/daemon` | Background service: wake-word, voice pipeline, agent probes |
| `packages/architect` | MetaAgent self-improvement scheduler |
| `apps/desktop` | Tauri desktop shell (Win/macOS/Linux) wrapping the core sidecar |
| `packages/web` | React + Vite admin UI |
| `os/` | Coastal.AI OS product — `base/` (shared), `kiosk/` (desktop ISO), `node/` (BC-250 image) |
| `packer/` | AWS AMI (Packer HCL) |
| `packaging/` | .deb packaging scripts |

## Making a change

1. Branch off `master`: `git checkout -b feat/your-thing`
2. Make changes; add tests for new behaviour
3. `pnpm test` must pass
4. `bash scripts/smoke-test-docker.sh` must pass for server-side changes
5. Open a PR — describe what and why

## Commit style

```
type(scope): short description

feat     — new feature
fix      — bug fix
refactor — code change with no behaviour change
test     — test-only change
docs     — documentation
chore    — build/CI/tooling
```

## Release process

Releases are automated via `.github/workflows/release.yml`:

1. Bump the version in `package.json`
2. Commit: `chore: bump to v0.x.0`
3. Tag: `git tag v0.x.0 && git push origin v0.x.0`
4. CI builds the `.deb`, creates the GitHub Release, and publishes to the APT branch

## Code of conduct

Be direct, constructive, and kind. That's it.
