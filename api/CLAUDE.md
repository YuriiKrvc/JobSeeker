# CLAUDE.md — api/

Guidance for the JobSeeker REST API. The repo-root `CLAUDE.md` holds the
cross-cutting rules (product scope, the API-is-the-only-contract rule, the
Postgres container). This file covers only `api/`.

## Status: scaffold only

Initialized 2026-09-01. The server boots, `/health` reaches Postgres, tests and
typecheck pass. **There is no domain code at all** — no tables, no migrations,
no adapters, no `/postings`. That is deliberate, not unfinished work: the
duplicate-handling rule is still open (below), and it decides the schema.

Do not add domain code without settling the open decisions first.

## Commands

Postgres comes from the compose file at the repo root. This machine has no
`docker compose` plugin — use the standalone binary:

```bash
cd .. && docker-compose up -d postgres
```

```bash
npm install
cp .env.example .env      # DATABASE_URL points at localhost:5432
npm run dev               # tsx watch, http://localhost:3000
npm test                  # vitest; no database required
npm run typecheck         # covers src, test, and *.config.ts
npm run lint              # eslint, type-aware rules
npm run format            # prettier --write .
npm run db:generate       # SQL from src/db/schema.ts (no tables yet — a no-op)
npm run db:migrate        # apply drizzle/*.sql — fails until a table exists
```

There is **no `dotenv`**. `dev`, `start`, and `db:migrate` load `.env` through
Node's own `--env-file-if-exists=.env`, so a deployment that exports the vars
and ships no `.env` file works unchanged. Anything else that imports
`config.ts` needs that flag too, or `process.env` reaches Zod empty and the
process exits with `Invalid environment`. `vitest.config.ts` sidesteps this by
setting the vars itself.

## Stack

Node 22 + TypeScript (ESM, `NodeNext`), Fastify 5, Drizzle ORM over
`postgres.js`, Zod 4 for input validation, Vitest, ESLint 9 (flat config,
type-aware) + Prettier.

`@eslint/js` is pinned to `^9`: its 10.x line requires ESLint 10, which
`typescript-eslint@8` does not yet support. Upgrade all three together or not
at all.

There are **two tsconfigs**. `tsconfig.json` is the checking config — it
covers `src`, `test`, and `*.config.ts`, has `noEmit`, and is what ESLint's
type-aware rules read. `tsconfig.build.json` is the only one that emits, and
it sees `src` alone. Add new top-level files to the first one or they go
unchecked and unlinted.

Two conventions that will bite you if you miss them:

- **Relative imports end in `.js`, not `.ts`** — required by `NodeNext`
  resolution. `tsx` and Vitest resolve them back to the `.ts` source.
- `strict` and `noUncheckedIndexedAccess` are on. Indexing an array yields
  `T | undefined`; handle it rather than asserting it away.

## Layout

```
src/
  config.ts       env parsed through Zod; exits on invalid env
  app.ts          buildApp() — registers routes, returns the instance
  server.ts       listen + SIGINT/SIGTERM shutdown. No logic lives here.
  db/
    schema.ts     Drizzle tables — empty, see Open decisions
    client.ts     lazy connection pool, `db` handle, closeDb()
    migrate.ts    applies drizzle/*.sql
  routes/         HTTP only — one file per resource
  services/       business logic (empty)
  repositories/   all SQL (empty)
drizzle/          generated migrations — committed, never hand-edited
test/
eslint.config.js  flat config
tsconfig.json     checking (src + test + configs) · tsconfig.build.json emits
```

`app.ts` is separate from `server.ts` so tests can build an instance and drive
it with `app.inject()` without binding a port. Keep it that way.

## Layering

**`routes → services → repositories`,** one direction only.

- **Routes** do HTTP and nothing else: parse and validate input with Zod, call
  one service, map the result to a status code. No SQL, no business rules.
- **Services** hold the logic and are the only layer worth unit-testing
  heavily. They take plain arguments and return plain data — a service must not
  see a `FastifyRequest` or set a status code.
- **Repositories** own every query. Drizzle imports belong here and nowhere
  else, so swapping a query never reaches past this layer.

The one exception is `routes/health.ts`, which pings the database directly.
It is an infrastructure probe, not domain logic — do not use it as precedent.

## Errors

**Fastify's default error handling, on purpose.** There is no `setErrorHandler`
and no domain error classes. An unhandled throw becomes a 500 with Fastify's
standard body; anything a route expects to fail, that route handles inline and
returns the status code for itself.

The cost of this choice is that error response shapes can drift between routes,
since nothing centralizes them. If that starts to hurt, the fix is one
`setErrorHandler` in `app.ts` plus typed errors thrown from services — do not
solve it by having services return status codes, which would break the layering
rule above.

## Decisions already made (not yet built)

- **Ingestion has two triggers**: a `POST` endpoint for on-demand runs, and a
  30-minute schedule. Both must call the _same_ ingestion service — the
  trigger is a thin entrypoint, never a second copy of the logic.
- **The schedule runs in-process via `@fastify/schedule`.** Not installed yet;
  wiring a scheduler with no job to run would be dead code. Add it with the
  ingestion service. Consequence to remember: ingestion shares the API process,
  so running two API instances would double-fetch.
- **Source adapters stay behind one interface.** How an adapter fetches — REST,
  RSS, scraped HTML, a browser — stays inside the adapter; nothing outside may
  assume any of it. Adding a source should mean adding one file and registering
  it. If a new source forces changes elsewhere, the interface is wrong.

## Open decisions — settle before writing the schema

- **The same job on several boards.** Root `CLAUDE.md` says one posting; the
  current instruction is to keep one row per source and not collapse them.
  Unresolved: whether the API still groups those rows into a single result for
  the frontend, or returns them separately. This determines whether postings
  need a cross-source fingerprint column at all, so the table cannot be written
  until it is answered.
- **Re-seeing a job from the same source** is a no-op: postings are assumed
  immutable once fetched, so nothing is updated. Uniqueness is therefore on
  `(source, source_id)`.

## Known wart

`npm audit` reports a moderate `esbuild` advisory reaching drizzle-kit through
`@esbuild-kit/*`. It affects an esbuild dev server this project never runs, and
`npm audit fix --force` downgrades drizzle-kit to 0.18 and breaks generation.
Left as is on purpose.
