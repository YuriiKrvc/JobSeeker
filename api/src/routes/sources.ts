import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  ErrorSchema,
  USER_ID_SECURITY,
  bodySchema,
  jsonSchema,
} from '../openapi.js'
import type { UsersRepository } from '../repositories/users.repository.js'
import type { SourcesService } from '../services/sources.service.js'
import { badRequest, fail, makeCaller, notFound, zodMessage } from './http.js'
import {
  SourceCreateSchema,
  SourceListResponseSchema,
  SourceResponseSchema,
  SourceUpdateBaseSchema,
  SourceUpdateSchema,
} from './sources.schema.js'

export interface SourcesRoutesOptions {
  service: SourcesService
  users: UsersRepository
}

const IdParams = z.object({ id: z.uuid() })

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505'

const errorResponses = {
  400: ErrorSchema,
  404: ErrorSchema,
}

export async function sourcesRoutes(
  app: FastifyInstance,
  { service, users }: SourcesRoutesOptions,
): Promise<void> {
  const caller = makeCaller(users)

  app.get(
    '/sources',
    {
      schema: {
        tags: ['sources'],
        summary: 'List your sources',
        description: 'Excludes deleted sources; includes disabled ones.',
        security: USER_ID_SECURITY,
        response: {
          200: jsonSchema(SourceListResponseSchema),
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      const userId = await caller(request, reply)
      if (!userId) return
      return { sources: await service.list(userId) }
    },
  )

  app.get(
    '/sources/:id',
    {
      schema: {
        tags: ['sources'],
        summary: 'Read one of your sources',
        security: USER_ID_SECURITY,
        params: jsonSchema(IdParams),
        response: { 200: jsonSchema(SourceResponseSchema), ...errorResponses },
      },
    },
    async (request, reply) => {
      const userId = await caller(request, reply)
      if (!userId) return
      // Ajv already validated `id` against `params: jsonSchema(IdParams)`
      // above; a second parse here would be dead code.
      const { id } = request.params as z.infer<typeof IdParams>
      const source = await service.get(userId, id)
      // A source owned by somebody else is indistinguishable from one that
      // does not exist. A 403 would confirm the id is real.
      if (!source) return notFound(reply)
      return source
    },
  )

  app.post(
    '/sources',
    {
      schema: {
        tags: ['sources'],
        summary: 'Add a source',
        description:
          'The owner comes from X-User-Id and nowhere else. The published body ' +
          'schema is looser than the real rules — see each field description.',
        security: USER_ID_SECURITY,
        // Ajv's default `removeAdditional: true` strips a `userId` key (or any
        // other key not in this schema) from the body before Zod ever parses
        // it — `.strict()` below never sees it and is not what guards against
        // it. The owner is `caller()`'s result, full stop.
        body: bodySchema(SourceCreateSchema),
        response: {
          201: jsonSchema(SourceResponseSchema),
          ...errorResponses,
          409: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = await caller(request, reply)
      if (!userId) return
      const parsed = SourceCreateSchema.safeParse(request.body)
      if (!parsed.success) return badRequest(reply, zodMessage(parsed.error))
      try {
        return await reply
          .code(201)
          .send(await service.create(userId, parsed.data))
      } catch (error) {
        return conflictOr(reply, error)
      }
    },
  )

  app.patch(
    '/sources/:id',
    {
      schema: {
        tags: ['sources'],
        summary: 'Update part of one of your sources',
        description:
          'An omitted key leaves the column alone; an explicit null clears ' +
          'an optional selector. At least one key is required.',
        security: USER_ID_SECURITY,
        params: jsonSchema(IdParams),
        // The published body is the unrefined partial: SourceUpdateSchema
        // carries a `.refine()` and z.toJSONSchema throws on refinements.
        // The "at least one key" rule is enforced below, not by Ajv.
        body: bodySchema(SourceUpdateBaseSchema),
        response: {
          200: jsonSchema(SourceResponseSchema),
          ...errorResponses,
          409: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = await caller(request, reply)
      if (!userId) return
      // Ajv already validated `id` against `params: jsonSchema(IdParams)`
      // above; a second parse here would be dead code.
      const { id } = request.params as z.infer<typeof IdParams>
      // Parsed against the refined schema, not the one published above — the
      // "at least one key" rule is not expressible in JSON Schema.
      const parsed = SourceUpdateSchema.safeParse(request.body)
      if (!parsed.success) return badRequest(reply, zodMessage(parsed.error))
      try {
        const source = await service.update(userId, id, parsed.data)
        if (!source) return notFound(reply)
        return source
      } catch (error) {
        return conflictOr(reply, error)
      }
    },
  )

  app.delete(
    '/sources/:id',
    {
      schema: {
        tags: ['sources'],
        summary: 'Delete one of your sources',
        description:
          'Soft — the row is retained so its postings keep resolving.',
        security: USER_ID_SECURITY,
        params: jsonSchema(IdParams),
        // Fastify skips payload serialization for a 204 regardless of what
        // is declared here, so this documents the response without
        // affecting the (empty) body the handler actually sends.
        response: { 204: { description: 'Deleted' }, ...errorResponses },
      },
    },
    async (request, reply) => {
      const userId = await caller(request, reply)
      if (!userId) return
      // Ajv already validated `id` against `params: jsonSchema(IdParams)`
      // above; a second parse here would be dead code.
      const { id } = request.params as z.infer<typeof IdParams>
      if (!(await service.remove(userId, id))) return notFound(reply)
      return reply.code(204).send()
    },
  )

  /**
   * `sources_user_name_uniq` is the only unique constraint reachable from
   * here, so a 23505 needs no disambiguation. The message avoids saying
   * anything about sources the caller cannot see.
   */
  function conflictOr(reply: FastifyReply, error: unknown) {
    if (pgErrorCode(error) !== UNIQUE_VIOLATION) throw error
    return fail(
      reply,
      409,
      'Conflict',
      'You already have a source with that name',
    )
  }
}

/**
 * drizzle-orm 0.45 wraps every driver error in `DrizzleQueryError`, so the
 * real `postgres.js` error — the one actually carrying `code` — sits one
 * level down at `.cause`, not on the error itself. Checked directly on the
 * live database: `error.code` is `undefined` and `error.cause.code` is
 * `'23505'`. Only one level is unwrapped on purpose — there is nothing below
 * `.cause` for this error shape, and unwrapping further would be a guess.
 */
function pgErrorCode(error: unknown): string | undefined {
  const direct = (error as { code?: string }).code
  if (direct !== undefined) return direct
  return (error as { cause?: { code?: string } }).cause?.code
}
