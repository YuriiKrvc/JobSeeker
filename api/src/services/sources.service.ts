import type {
  SourceRow,
  SourcesRepository,
} from '../repositories/sources.repository.js'
import type {
  SourceCreate,
  SourceResponse,
  SourceUpdate,
} from '../routes/sources.schema.js'

/**
 * Blocklist matching is case-insensitive, so words are stored lowercased and
 * trimmed rather than normalized on every comparison at scrape time. This lives
 * here and not in the Zod schema because `z.toJSONSchema` throws on transforms
 * and that schema has to reach the OpenAPI document.
 */
function normalizeWords(words: string[]): string[] {
  return words
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length > 0)
}

/**
 * Row -> wire shape. Drops `userId` and `deletedAt`, which are internal, and
 * turns `Date` into an ISO string so the response matches
 * `SourceResponseSchema`.
 */
function toResponse(row: SourceRow): SourceResponse {
  const { userId: _userId, deletedAt: _deletedAt, ...rest } = row
  return {
    ...rest,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function createSourcesService(repo: SourcesRepository) {
  return {
    async list(userId: string): Promise<SourceResponse[]> {
      return (await repo.list(userId)).map(toResponse)
    },

    async get(userId: string, id: string): Promise<SourceResponse | null> {
      const row = await repo.findById(userId, id)
      return row ? toResponse(row) : null
    },

    async create(userId: string, input: SourceCreate): Promise<SourceResponse> {
      // userId comes from the header and nowhere else, so a caller cannot
      // create a source owned by somebody else.
      const row = await repo.create({
        ...input,
        userId,
        blockedTitleWords: normalizeWords(input.blockedTitleWords),
        blockedDescriptionWords: normalizeWords(input.blockedDescriptionWords),
      })
      return toResponse(row)
    },

    async update(
      userId: string,
      id: string,
      patch: SourceUpdate,
    ): Promise<SourceResponse | null> {
      // Only the keys actually present are touched: an absent key leaves the
      // column alone, an explicit null clears it.
      const normalized: SourceUpdate = { ...patch }
      if (patch.blockedTitleWords) {
        normalized.blockedTitleWords = normalizeWords(patch.blockedTitleWords)
      }
      if (patch.blockedDescriptionWords) {
        normalized.blockedDescriptionWords = normalizeWords(
          patch.blockedDescriptionWords,
        )
      }
      const row = await repo.update(userId, id, normalized)
      return row ? toResponse(row) : null
    },

    async remove(userId: string, id: string): Promise<boolean> {
      return repo.softDelete(userId, id)
    },
  }
}

export type SourcesService = ReturnType<typeof createSourcesService>
