import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    globals: false,
    include: ['src/**/__tests__/**/*.test.ts'],
    // Run each test file in a forked child process rather than a worker
    // thread. Several suites here open native better-sqlite3 handles; on
    // Windows the addon's finalizer can fault during worker_thread teardown,
    // crashing the runner with an access violation (0xC0000005) even when
    // every test passes. A forked process owns its own native handles and
    // unwinds them cleanly on exit.
    pool: 'forks',
  },
})
