## Health Stack

- typecheck: pnpm exec turbo run build --filter='!@coastal-ai/desktop' -- (per-package `tsc`/`tsc -b` runs as part of each package's build script)
- lint: pnpm exec turbo lint --filter='!@coastal-ai/desktop'
- test: pnpm exec turbo test --filter='!@coastal-ai/desktop'
- deadcode: skipped (knip not installed)
- shell: skipped (shellcheck not installed; shell scripts present under scripts/, packaging/, flash.sh, install.sh)

`@coastal-ai/desktop` is excluded from all of the above — its build requires a
separately-bundled native sidecar (`pnpm --filter @coastal-ai/core bundle:sidecar`)
that isn't part of normal CI/dev flow; see `.github/workflows/ci.yml`'s own exclusion
of it for the same reason.
