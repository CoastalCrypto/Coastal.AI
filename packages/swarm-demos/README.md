# @coastal-ai/swarm-demos

Runnable demonstrations of the Coastal.AI multi-agent stack. Each demo spins up
several `CoordinationDaemon`s in a single process — one SQLite DB per daemon,
synced only through broadcast-based replication — which is the exact shape the
12-node BC-250 cluster ships, with `LocalhostBus` standing in for the real
TCP + mDNS network.

## Why this is its own package

The demos compose `@coastal-ai/coordination` **and** the role-agent packages
(`coding-agent`, `reviewing-agent`, `planner-agent`, `mission-control`). Those
role agents depend on `coordination`. If the demos lived inside `coordination`,
`coordination` would have to declare the role agents as dependencies — and that
closes a cycle (`coordination → planner-agent → coordination`) that Turbo's
build graph rejects.

Putting the demos in a leaf package that nothing depends on keeps every edge
pointing one way:

```
swarm-demos ──▶ coordination
swarm-demos ──▶ coding-agent ──▶ coordination
swarm-demos ──▶ planner-agent ──▶ coordination
swarm-demos ──▶ mission-control ──▶ coordination
```

No back-edges, no cycle.

## Demos

| Command | What it shows |
|---|---|
| `pnpm --filter @coastal-ai/swarm-demos demo` | 3 nodes (main + coder + reviewer), 6 tasks, basic broadcast replication and convergence. |
| `pnpm --filter @coastal-ai/swarm-demos demo:full` | Full stack: planner decomposes a goal into code + review subtasks with a `must_complete` dependency edge; coder and reviewer drain them. |
| `pnpm --filter @coastal-ai/swarm-demos demo:live` | Runs forever, submitting a new plan every 5s. Open the mission-control dashboard at `http://localhost:<port>/` to watch the swarm live (SSE auto-refresh). |
