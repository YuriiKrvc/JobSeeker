import { buildApp } from './app.js'
import { config } from './config.js'
import { closeDb } from './db/client.js'

const app = buildApp()

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, 'shutting down')
  await app.close()
  await closeDb()
  process.exit(0)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  // `process.once` expects a void-returning listener, so the promise is
  // explicitly discarded rather than silently floated.
  process.once(signal, () => {
    void shutdown(signal)
  })
}

try {
  await app.listen({ port: config.PORT, host: '0.0.0.0' })
} catch (error) {
  app.log.error({ error }, 'failed to start')
  process.exit(1)
}
