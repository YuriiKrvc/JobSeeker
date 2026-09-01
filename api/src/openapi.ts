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
export function jsonSchema(schema: ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'draft-7' })
}

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
        description: 'Aggregated job postings. Single user, self-hosted.',
        version: '0.1.0',
      },
    },
  })

  app.register(swaggerUi, { routePrefix: '/docs' })
}
