import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import type { FastifyInstance } from 'fastify'
import { z, type ZodType } from 'zod'

/**
 * Zod schema -> the JSON Schema that Fastify already speaks.
 *
 * Routes keep Zod as the single source of truth, but hand Fastify plain JSON
 * Schema, so validation runs through the stock Ajv/fast-json-stringify pipeline
 * and `@fastify/swagger` picks the same object up for the OpenAPI document.
 * No custom validator compiler and no type-provider package involved.
 *
 * `draft-7` is deliberate: it is the dialect Fastify's Ajv is configured for.
 * Zod emits `const` for literals, which is valid there, in fast-json-stringify,
 * and in OpenAPI 3.1 — hence 3.1 below rather than 3.0.
 */
export function jsonSchema(
  schema: ZodType,
  io: 'input' | 'output' = 'output',
): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'draft-7', io })
}

/** Request bodies. See the `io` note on `jsonSchema`. */
export function bodySchema(schema: ZodType): Record<string, unknown> {
  return jsonSchema(schema, 'input')
}

/**
 * Fastify's default error body. There is no `setErrorHandler` (see CLAUDE.md,
 * Errors), so this is the shape every failure actually has — including the
 * ones routes produce themselves, which must match it deliberately.
 */
export const ErrorSchema = jsonSchema(
  z.object({
    statusCode: z.number().int(),
    error: z.string(),
    message: z.string(),
  }),
)

/**
 * Spread into a route's schema to mark it as requiring the caller's identity.
 * `userId` is the scheme registered below; when real authentication replaces
 * the header, this constant and the scheme are what change.
 */
export const USER_ID_SECURITY = [{ userId: [] }]

/**
 * Must run before any route is registered — `@fastify/swagger` collects routes
 * through an `onRoute` hook and cannot see ones added earlier.
 */
export function registerDocs(app: FastifyInstance): void {
  app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'JobSeeker API',
        description:
          'Aggregated job postings. Multi-user: every request identifies its ' +
          'caller with an X-User-Id header, and a caller only ever sees their ' +
          'own data.',
        version: '0.1.0',
      },
      components: {
        securitySchemes: {
          // A stand-in for authentication. An apiKey scheme rather than a
          // plain header parameter so swagger-ui offers an Authorize box you
          // fill once, and so a real scheme can replace it in place.
          userId: {
            type: 'apiKey',
            in: 'header',
            name: 'X-User-Id',
            description: 'A user uuid. Temporary — this is not authentication.',
          },
        },
      },
    },
  })

  app.register(swaggerUi, { routePrefix: '/docs' })
}
