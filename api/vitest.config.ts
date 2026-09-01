import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    env: {
      LOG_LEVEL: 'silent',
      // config.ts exits the process on a missing var, so this must be set
      // even though no test opens a connection — postgres.js connects lazily,
      // so importing the client is free.
      DATABASE_URL: 'postgres://jobseeker:jobseeker@localhost:5432/jobseeker',
    },
  },
})
