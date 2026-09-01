import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { closeDb, db } from './client.js'

// Fails until `npm run db:generate` has produced at least one migration.
await migrate(db, { migrationsFolder: './drizzle' })
await closeDb()
console.log('migrations applied')
