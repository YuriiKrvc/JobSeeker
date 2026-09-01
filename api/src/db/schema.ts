import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Drizzle table definitions — the source of truth for the database.
 *
 * Column names are snake_case; the TypeScript properties are camelCase, which
 * is also the wire format. After changing anything here run
 * `npm run db:generate` and commit the SQL.
 */

/** A `text[]` column defaulting to the empty array. */
const wordList = (column: string) =>
  text(column)
    .array()
    .notNull()
    .default(sql`'{}'::text[]`)

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  // Blocklists live here rather than in a settings table: there is no other
  // user-level setting yet, so a second table would be a join earning nothing.
  blockedTitleWords: wordList('blocked_title_words'),
  blockedDescriptionWords: wordList('blocked_description_words'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const sources = pgTable(
  'sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    listingUrl: text('listing_url').notNull(),
    enabled: boolean('enabled').notNull().default(true),

    // Listing page.
    itemSelector: text('item_selector').notNull(),
    titleSelector: text('title_selector').notNull(),
    titleAttr: text('title_attr'),
    detailUrlSelector: text('detail_url_selector').notNull(),
    detailUrlAttr: text('detail_url_attr').notNull().default('href'),

    // Detail page.
    descriptionSelector: text('description_selector').notNull(),
    descriptionAttr: text('description_attr'),
    companySelector: text('company_selector'),
    companyAttr: text('company_attr'),
    postedAtSelector: text('posted_at_selector'),
    postedAtAttr: text('posted_at_attr'),

    blockedTitleWords: wordList('blocked_title_words'),
    blockedDescriptionWords: wordList('blocked_description_words'),

    requestTimeoutMs: integer('request_timeout_ms').notNull().default(10000),
    detailDelayMs: integer('detail_delay_ms').notNull().default(1000),
    maxItemsPerRun: integer('max_items_per_run').notNull().default(100),

    // Written by the ingestion pipeline, never by the API.
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastError: text('last_error'),

    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Partial, on two counts. Scoped to the user because a global constraint
    // would leak the existence of sources the caller cannot see. Excluding
    // soft-deleted rows because otherwise a deleted source holds its name
    // hostage forever.
    uniqueIndex('sources_user_name_uniq')
      .on(table.userId, table.name)
      .where(sql`${table.deletedAt} is null`),
    index('sources_user_live_idx')
      .on(table.userId)
      .where(sql`${table.deletedAt} is null`),
  ],
)

export const postings = pgTable(
  'postings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // No user_id: ownership is source_id's to answer. One fact stored once
    // cannot drift out of agreement with itself.
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id),
    /** Absolutized detail URL. The identity of a posting. */
    url: text('url').notNull(),
    title: text('title').notNull(),
    company: text('company'),
    description: text('description').notNull(),
    /** As scraped, e.g. "3 days ago" — kept so a parse misfire stays visible. */
    postedAtRaw: text('posted_at_raw'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    /** Null means visible; otherwise the blocklist word that matched. */
    blockedBy: text('blocked_by'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique('postings_source_url_uniq').on(table.sourceId, table.url)],
)
