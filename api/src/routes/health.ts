import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client.js'
import { jsonSchema } from '../openapi.js'

const healthUp = z.object({
  status: z.literal('ok'),
  database: z.literal('up'),
})

const healthDown = z.object({
  status: z.literal('degraded'),
  database: z.literal('down'),
})

/**
 * Liveness + database reachability. This is the one route allowed to touch the
 * database directly — it is infrastructure, not domain. Every other route goes
 * through a service (see CLAUDE.md, Layering).
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Liveness and database reachability',
        response: {
          200: jsonSchema(healthUp),
          503: jsonSchema(healthDown),
        },
      },
    },
    async (_request, reply) => {
      try {
        await db.execute(sql`select 1`)
        return { status: 'ok', database: 'up' }
      } catch (error) {
        app.log.error({ error }, 'health check: database unreachable')
        return reply.code(503).send({ status: 'degraded', database: 'down' })
      }
    },
  )
}
