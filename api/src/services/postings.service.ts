import type {
  PostingRow,
  PostingsRepository,
} from '../repositories/postings.repository.js'
import type {
  PostingResponse,
  PostingsQuery,
} from '../routes/postings.schema.js'

/** Row -> wire shape: `Date` becomes an ISO string, nothing is dropped. */
function toResponse(row: PostingRow): PostingResponse {
  return {
    ...row,
    postedAt: row.postedAt?.toISOString() ?? null,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  }
}

export function createPostingsService(repo: PostingsRepository) {
  return {
    async search(
      userId: string,
      query: PostingsQuery,
    ): Promise<{ items: PostingResponse[]; total: number }> {
      const { items, total } = await repo.search(userId, query)
      return { items: items.map(toResponse), total }
    },
  }
}

export type PostingsService = ReturnType<typeof createPostingsService>
