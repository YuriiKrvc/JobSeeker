import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'

/**
 * Narrow on purpose. Nothing in this slice creates, edits or lists users —
 * the one row that exists comes from a migration.
 */
export interface UsersRepository {
  exists(id: string): Promise<boolean>
  /**
   * The owner's two blocklists, which apply across all of their sources. Read
   * once per source run and unioned with the source's own lists.
   */
  findBlocklists(
    userId: string,
  ): Promise<{ blockedTitleWords: string[]; blockedDescriptionWords: string[] }>
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

    async findBlocklists(userId) {
      const rows = await db
        .select({
          blockedTitleWords: users.blockedTitleWords,
          blockedDescriptionWords: users.blockedDescriptionWords,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
      // A caller that got this far was resolved by `resolveCurrentUser`, so the
      // row exists; empty lists are the safe reading if it somehow does not.
      return rows[0] ?? { blockedTitleWords: [], blockedDescriptionWords: [] }
    },
  }
}
