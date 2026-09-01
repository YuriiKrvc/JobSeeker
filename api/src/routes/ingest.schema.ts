import { z } from 'zod'

/**
 * One unusable listing item, or one detail page that could not be fetched. A
 * run reports these and still succeeds: a board where one posting 503s is a
 * working board.
 */
export const ItemErrorSchema = z.object({
  url: z
    .string()
    .describe('The listing URL for a bad item, else the detail URL'),
  message: z.string(),
})

export const RunSummarySchema = z.object({
  sourceId: z.uuid(),
  fetched: z
    .number()
    .int()
    .nonnegative()
    .describe(
      'Items accounted for: post-truncation items plus unusable listing entries. ' +
        'created + updated + blocked + errors.length equals this.',
    ),
  created: z.number().int().nonnegative().describe('Newly stored and visible'),
  updated: z
    .number()
    .int()
    .nonnegative()
    .describe('Already stored; lastSeenAt advanced and no detail page fetched'),
  blocked: z
    .number()
    .int()
    .nonnegative()
    .describe('Newly stored with blockedBy set'),
  truncated: z
    .boolean()
    .describe('True when maxItemsPerRun cut the listing short'),
  errors: z.array(ItemErrorSchema),
})

export const BulkRunResponseSchema = z.object({
  runs: z.array(RunSummarySchema),
})
