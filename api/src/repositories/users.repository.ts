import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'

/**
 * Narrow on purpose. Nothing in this slice creates, edits or lists users —
 * the one row that exists comes from a migration.
 */
export interface UsersRepository {
  exists(id: string): Promise<boolean>
}

export function createUsersRepository(): UsersRepository {
  return {
    async exists(id) {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, id))
        .limit(1)
      return rows.length > 0
    },
  }
}
