import { USER_ID_SECURITY, jsonSchema } from '../openapi.js'
import { badRequest, errorResponses, makeCaller, zodMessage } from './http.js'
import {
  PostingListResponseSchema,
  PostingsQueryPublishedSchema,
  PostingsQuerySchema,
} from './postings.schema.js'
import type { FastifyInstance } from 'fastify'
import type { UsersRepository } from '../repositories/users.repository.js'
import type { PostingsService } from '../services/postings.service.js'

export interface PostingsRoutesOptions {
  service: PostingsService
  users: UsersRepository
}

export async function postingsRoutes(
  app: FastifyInstance,
  { service, users }: PostingsRoutesOptions,
): Promise<void> {
  const caller = makeCaller(users)

  app.get(
    '/postings',
    {
      schema: {
        tags: ['postings'],
        summary: 'Search your postings',
        description:
          'Newest first. Scoped to your own sources, so another user’s ' +
          'sourceId returns an empty page rather than a 404 — it is a filter, ' +
          'not a lookup. Blocked postings are excluded unless asked for.',
        security: USER_ID_SECURITY,
        querystring: jsonSchema(PostingsQueryPublishedSchema, 'input'),
        response: {
          200: jsonSchema(PostingListResponseSchema),
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      const userId = await caller(request, reply)
      if (!userId) return
      // Ajv has already coerced and defaulted the query; this second parse
      // applies the clamp, which JSON Schema cannot express.
      const parsed = PostingsQuerySchema.safeParse(request.query)
      if (!parsed.success) return badRequest(reply, zodMessage(parsed.error))
      return service.search(userId, parsed.data)
    },
  )
}
