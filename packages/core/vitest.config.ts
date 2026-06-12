import { defineConfig, configDefaults } from 'vitest/config'
export default defineConfig({
  test: {
    env: {
      MOCK_NAMESPACE: '1',
    },
    // Never discover tests inside the sidecar build artifact (a deployed copy
    // of dist/scripts would otherwise be picked up with broken relative paths).
    exclude: [...configDefaults.exclude, '**/sidecar-build/**'],
  },
})
