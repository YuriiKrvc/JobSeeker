import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { db } from '../db/client.js'

/**
 * Liveness + database reachability. This is the one route allowed to touch the
 * database directly — it is infrastructure, not domain. Every other route goes
 * through a service (see CLAUDE.md, Layering).
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_request, reply) => {
    try {
      await db.execute(sql`select 1`)
      return { status: 'ok', database: 'up' }
    } catch (error) {
      app.log.error({ error }, 'health check: database unreachable')
      return reply.code(503).send({ status: 'degraded', database: 'down' })
    }
  })
}
