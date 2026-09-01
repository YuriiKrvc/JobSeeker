import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    env: {
      DATABASE_URL: 'postgres://jobseeker:jobseeker@localhost:5432/jobseeker',
      LOG_LEVEL: 'silent',
    },
  },
})
