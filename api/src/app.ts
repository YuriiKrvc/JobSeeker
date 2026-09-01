import Fastify, { type FastifyInstance } from 'fastify'
import { fetchText } from './adapters/fetch-text.js'
import { config } from './config.js'
import { registerDocs } from './openapi.js'
import { createPostingsRepository } from './repositories/postings.repository.js'
import { createSourcesRepository } from './repositories/sources.repository.js'
import { createUsersRepository } from './repositories/users.repository.js'
import { healthRoutes } from './routes/health.js'
import { ingestRoutes } from './routes/ingest.js'
import { sourcesRoutes } from './routes/sources.js'
import { createIngestionService } from './services/ingestion.service.js'
import { createPostingsService } from './services/postings.service.js'
import { createSourcesService } from './services/sources.service.js'
import type { UsersRepository } from './repositories/users.repository.js'
import type { IngestionService } from './services/ingestion.service.js'
import type { PostingsService } from './services/postings.service.js'
import type { SourcesService } from './services/sources.service.js'

export interface AppDeps {
  sources: SourcesService
  postings: PostingsService
  users: UsersRepository
  ingestion: IngestionService
}

/**
 * The real dependencies. Built lazily inside `buildApp` rather than at module
 * scope so that a test passing its own fakes never constructs them.
 */
function realDeps(): AppDeps {
  const users = createUsersRepository()
  const sourcesRepo = createSourcesRepository()
  const postingsRepo = createPostingsRepository()
  return {
    sources: createSourcesService(sourcesRepo),
    postings: createPostingsService(postingsRepo),
    users,
    // `fetchText` is injected rather than imported by the service, so the unit
    // suite never opens a socket.
    ingestion: createIngestionService({
      sources: sourcesRepo,
      postings: postingsRepo,
      users,
      fetchText,
    }),
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
  app.register(ingestRoutes, { service: deps.ingestion, users: deps.users })

  return app
}
