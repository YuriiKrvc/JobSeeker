import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { config } from '../config.js'
import * as schema from './schema.js'

// postgres.js connects lazily — importing this module opens no socket.
const sql = postgres(config.DATABASE_URL, { max: 10 })

export const db = drizzle(sql, { schema })

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 })
}
