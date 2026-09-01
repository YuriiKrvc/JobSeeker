import Fastify, { type FastifyInstance } from 'fastify'
import { config } from './config.js'
import { registerDocs } from './openapi.js'
import { createSourcesRepository } from './repositories/sources.repository.js'
import { createUsersRepository } from './repositories/users.repository.js'
import { healthRoutes } from './routes/health.js'
import { sourcesRoutes } from './routes/sources.js'
import { createSourcesService } from './services/sources.service.js'
import type { UsersRepository } from './repositories/users.repository.js'
import type { SourcesService } from './services/sources.service.js'

export interface AppDeps {
  sources: SourcesService
  users: UsersRepository
}

/**
 * The real dependencies. Built lazily inside `buildApp` rather than at module
 * scope so that a test passing its own fakes never constructs them.
 */
function realDeps(): AppDeps {
  return {
    sources: createSourcesService(createSourcesRepository()),
    users: createUsersRepository(),
  }
}

/**
 * Builds a configured instance without binding a port, so tests can drive it
 * through `app.inject()`. Keep listening and process concerns in server.ts.
 *
 * `deps` exists so the unit suite can run the whole HTTP stack against
 * in-memory repositories — no database, per the test contract in CLAUDE.md.
 */
export function buildApp(deps: AppDeps = realDeps()): FastifyInstance {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } })

  // Before the routes: swagger only documents what is registered after it.
  registerDocs(app)

  app.register(healthRoutes)
  app.register(sourcesRoutes, { service: deps.sources, users: deps.users })

  return app
}
