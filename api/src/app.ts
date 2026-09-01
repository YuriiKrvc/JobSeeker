import Fastify, { type FastifyInstance } from 'fastify'
import { config } from './config.js'
import { registerDocs } from './openapi.js'
import { healthRoutes } from './routes/health.js'

/**
 * Builds a configured instance without binding a port, so tests can drive it
 * through `app.inject()`. Keep listening and process concerns in server.ts.
 */
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } })

  // Before the routes: swagger only documents what is registered after it.
  registerDocs(app)

  app.register(healthRoutes)

  return app
}
