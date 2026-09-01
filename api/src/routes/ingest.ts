import { z } from 'zod'
import {
  ErrorSchema,
  USER_ID_SECURITY,
  jsonSchema,
} from '../openapi.js'
import { conflict, makeCaller, notFound } from './http.js'
import { BulkRunResponseSchema, RunSummarySchema } from './ingest.schema.js'
import type { FastifyInstance } from 'fastify'
import type { UsersRepository } from '../repositories/users.repository.js'
import type { IngestionService } from '../services/ingestion.service.js'

export interface IngestRoutesOptions {
  service: IngestionService
  users: UsersRepository
}

const IdParams = z.object({ id: z.uuid() })

const errorResponses = {
  400: ErrorSchema,
  404: ErrorSchema,
}

/**
 * Both routes are thin: resolve the caller, call the one ingestion service, map
 * its result to a status code. The 30-minute schedule will be a third caller of
 * that same service, which is why no logic may accumulate here.
 *
 * Runs are synchronous. A source with the default 100-item cap and 1s delay
 * takes ~100 seconds, and POST /ingest runs sources one at a time, so a caller
 * needs a long timeout and a proxy with a 60s read timeout will cut the
 * connection while the run finishes server-side.
 */
export async function ingestRoutes(
  app: FastifyInstance,
  { service, users }: IngestRoutesOptions,
): Promise<void> {
  const caller = makeCaller(users)

  app.post(
    '/sources/:id/ingest',
    {
      schema: {
        tags: ['ingest'],
        summary: 'Scrape one of your sources now',
        description:
          'Runs synchronously and answers when the run finishes; expect this ' +
          'to take maxItemsPerRun x detailDelayMs. A listing page that cannot ' +
          'be fetched is still a 200: the failure is in errors[] and in the ' +
          "source's lastError. A disabled source is a 409.",
        security: USER_ID_SECURITY,
        params: jsonSchema(IdParams),
        response: {
          200: jsonSchema(RunSummarySchema),
          ...errorResponses,
          409: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = await caller(request, reply)
      if (!userId) return
      // Ajv already validated `id` against `params` above; parsing again here
      // would be dead code.
      const { id } = request.params as z.infer<typeof IdParams>
      const result = await service.ingestOne(userId, id)
      if (!result.ok) {
        // A source owned by somebody else is indistinguishable from one that
        // does not exist. A 403 would confirm the id is real.
        return result.reason === 'not-found'
          ? notFound(reply)
          : conflict(reply, 'Source is disabled')
      }
      return result.summary
    },
  )

  app.post(
    '/ingest',
    {
      schema: {
        tags: ['ingest'],
        summary: 'Scrape all of your enabled sources now',
        description:
          'Sources run one at a time in name order, so this can take the sum ' +
          'of all of them. Disabled sources are skipped silently — unlike the ' +
          'single-source route, which refuses them. A source that fails still ' +
          'contributes a summary and the next source runs.',
        security: USER_ID_SECURITY,
        response: {
          200: jsonSchema(BulkRunResponseSchema),
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      const userId = await caller(request, reply)
      if (!userId) return
      return { runs: await service.ingestAll(userId) }
    },
  )
}
