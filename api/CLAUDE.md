# CLAUDE.md — api/

Guidance for the JobSeeker REST API. The repo-root `CLAUDE.md` holds the
cross-cutting rules (product scope, the API-is-the-only-contract rule, the
Postgres container). This file covers only `api/`.

## Status

The sources API is built: three tables (`users`, `sources`, `postings`), CRUD
at `/sources`, and an OpenAPI document at `/docs`. **Nothing fetches any job
board yet** — `postings` is created but written by nothing. The generic
adapter, the ingestion pipeline, the `POST` trigger and the 30-minute schedule
are the next slice.

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
npm run db:generate       # SQL from src/db/schema.ts, into drizzle/
npm run db:migrate        # apply drizzle/*.sql
```

There is **no `dotenv`**. `dev`, `start`, and `db:migrate` load `.env` through
Node's own `--env-file-if-exists=.env`, so a deployment that exports the vars
and ships no `.env` file works unchanged. Anything else that imports
`config.ts` needs that flag too, or `process.env` reaches Zod empty and the
process exits with `Invalid environment`. `vitest.config.ts` sidesteps this by
setting the vars itself.

The URL there points at the same local Postgres as `.env.example`, but nothing
in the unit suite connects: `postgres.js` opens a socket on first query, and
tests inject fake repositories rather than the real ones.

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
    schema.ts     Drizzle tables — users, sources, postings
    client.ts     lazy connection pool, `db` handle, closeDb()
    migrate.ts    applies drizzle/*.sql
  routes/         HTTP only — one file per resource
  services/       business logic
  repositories/   all SQL
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

## Two validators, one status code

Request bodies are validated **twice**, on purpose. The route declares
`body: bodySchema(Schema)` so Fastify's Ajv checks it and `@fastify/swagger`
publishes it; the handler then runs `Schema.safeParse` for the rules JSON
Schema cannot express — the http/https protocol check, the "at least one key"
rule on a patch.

Two consequences a later reader will otherwise take for bugs:

- **The published schema is deliberately looser than the real rule.** A body
  that satisfies the document can still be rejected. The strict rules live in
  each field's `.describe()`.
- **`bodySchema` converts with `io: 'input'`, `jsonSchema` with `'output'`.**
  Under `'output'` Zod marks every `.default()` field `required`, and Ajv would
  reject bodies that Zod accepts. Responses want `'output'`.

Fastify's default Ajv also runs with `removeAdditional: true`, so an unknown
key in a request body is stripped before the handler ever runs — Zod's
`.strict()` never sees it and is not what rejects a body-supplied `userId`.

The PATCH route publishes `bodySchema(SourceUpdateBaseSchema)` — the
unrefined partial — while the handler parses the refined `SourceUpdateSchema`,
because `z.toJSONSchema` throws on a `.refine()`; the published document is
therefore looser than the handler in this one additional way.

Because 400 is a documented response shape, handlers reproduce Fastify's
`{ statusCode, error, message }` body by hand rather than inventing one — with
no `setErrorHandler` there is nothing to normalize it for them.

## Isolation

Every user sees only their own data. `sources.user_id` is the sole ownership
record; postings derive theirs through `source_id`. `SourcesRepository` exposes
no method that does not take a `userId`, so there is no unscoped query to
forget to scope. Another user's source id returns **404**, never 403.

`X-User-Id` stands in for authentication and **must not reach a deployment** —
any caller can claim to be any user. `src/auth/current-user.ts` is the only
place that changes when sessions arrive.

## Decisions already made (not yet built)

- **Ingestion has two triggers**: a `POST` endpoint for on-demand runs, and a
  30-minute schedule. Both must call the _same_ ingestion service — the
  trigger is a thin entrypoint, never a second copy of the logic.
- **The schedule runs in-process via `@fastify/schedule`.** Not installed yet;
  wiring a scheduler with no job to run would be dead code. Add it with the
  ingestion service. Consequence to remember: ingestion shares the API process,
  so running two API instances would double-fetch.
- **A source is a row, not a file.** One generic adapter reads `sources` — a
  listing URL plus CSS selectors, page one only, plain HTTP and cheerio, no
  headless browser. Adding a board is a `POST /sources`. This reverses an
  earlier decision that each board would be its own TypeScript file.

## Known wart

`npm audit` reports a moderate `esbuild` advisory reaching drizzle-kit through
`@esbuild-kit/*`. It affects an esbuild dev server this project never runs, and
`npm audit fix --force` downgrades drizzle-kit to 0.18 and breaks generation.
Left as is on purpose.
