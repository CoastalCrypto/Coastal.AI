# Two-node cluster-join E2E (hardware/runtime-gated)

This harness proves the full cluster-join chain end-to-end: a worker-authored
note converges cluster-wide via Syncthing, and both nodes report healthy
heartbeats via openobserve. It is **deferred verification** — it requires a
Docker host and is not run by default CI.

## Status: skeleton

`docker-compose.yml` is the topology skeleton. Two operator steps remain to
stand it up on a Docker host (intentionally not built blind here — they need a
live environment to iterate against):

1. **`Dockerfile`** — base image with Node + `pnpm` + `syncthing`, copying the
   repo, building `@coastal-ai/coordination`, and running the CLI from source
   via `tsx src/cli.ts` (the `node-runtime` build is typecheck-only). The compose
   `build.dockerfile` already points at `packages/node-runtime/e2e/Dockerfile`.
2. **Per-role `/etc/coastal/node.json` bootstrap** — an entrypoint that writes
   `node.json` from `COASTAL_ROLE` (curator vs coder) + the container hostname,
   then runs `coastal-cluster emit-public` before `coastal-cluster run`. Mirrors
   what `coastal-os-first-boot` does on real hardware.

## Runbook

Prereqs: a Docker host.

1. `docker compose -f docker-compose.yml up --build`
2. Each container self-generates its identity + Syncthing device, writes its tuple.
3. From the host: `coastal-cluster-provision hosts.txt`
   (`hosts.txt` = the curator + worker exec/ssh targets).
4. **Assert convergence:** author a note in the worker's NoteStore (kind
   `learning`), wait one `TICK_MS` (15s) + sync; confirm it appears in the
   curator's `shared-vault`, then propagates back to the worker's read-only vault
   replica.
5. **Assert health:** query openobserve `heartbeats` — both `nodeId`s present,
   `ok=true`, `ts` within `STALENESS_MS`. Run the monitor role and confirm zero
   critical alerts.

## Exit criteria

A worker-authored note is visible cluster-wide **and** both nodes report healthy
heartbeats. This is the deferred "manual 2-container E2E" called for by both the
Syncthing replication and openobserve Monitor specs.
