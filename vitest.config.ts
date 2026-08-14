import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.{ts,tsx}'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/**/*.{ts,tsx}'],
      thresholds: {
        perFile: true,
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
})
