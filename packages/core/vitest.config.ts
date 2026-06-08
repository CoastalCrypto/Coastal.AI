import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    env: {
      MOCK_NAMESPACE: '1',
    },
    // Run each test file in a forked child process rather than a worker
    // thread. Core's stores open native better-sqlite3 handles; on Windows
    // the addon's finalizer can fault during worker_thread teardown,
    // crashing the runner with an access violation (0xC0000005) on exit
    // even when every test passes. A forked process owns its own native
    // handles and unwinds them cleanly. (Same remedy as packages/architect.)
    pool: 'forks',
  },
})
