# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

`api/` is scaffolded — it boots and reaches Postgres, but has no domain code
yet. Its commands, layout, and layering rules live in **`api/CLAUDE.md`**.
`frontend/` is still an empty directory; what is said about it here is a
decision, not an observation.

Each subproject owns its own `CLAUDE.md`, and Claude Code loads them
automatically when it touches files in that directory. There is no import
linking them on purpose — this file stays cross-cutting, so API detail belongs
in `api/CLAUDE.md`, not here.

## What it is

Aggregates job postings from multiple sources into one searchable place.
Single user, self-hosted.

## Stack

- `api/` — Node + TypeScript
- `frontend/` — React + Vite + TypeScript
- Postgres for storage

**Two independent projects, no shared source and no shared tooling.** Each owns
its own `package.json` and installs separately. The REST API is the entire
contract between them — if the frontend needs something, it goes through an
endpoint, never through an import.

## Scope

In: fetching postings from sources, deduplicating them, storing them, and
searching/filtering them in the UI.

Deliberately **not** in the first version:

- relevance scoring or AI matching against a CV
- application tracking (applied / rejected / interviewing)
- alerts and notifications

These are excluded on purpose, not forgotten. Do not add them because they seem
like the obvious next step — ask first.

A **30-minute ingestion schedule is now in scope** (it was excluded here
originally). It runs in the API process; see `api/CLAUDE.md`.

## Architecture

The one seam that matters: **source adapters.** Each job board is a single
adapter behind a common interface, and the interface returns normalized
postings.

How an adapter fetches is undecided — some sources have real APIs, others will
need scraping. That decision stays *inside* the adapter. Nothing outside an
adapter may assume HTML, or JSON, or a browser, or a rate limit shape. Adding a
source should mean adding one file and registering it, and touching nothing
else.

**Duplicate handling is unsettled.** The original rule here was that one job on
three boards is one posting. The current instruction is the opposite: keep one
row per source and do not collapse across sources, since a re-seen posting from
the same source is assumed unchanged and is simply ignored. What has *not* been
decided is whether the API groups those rows into a single result for the
frontend. Until that is answered, the postings table is not written — see the
Open decisions section of `api/CLAUDE.md`.

What still holds either way: any collapsing is a job for the merged result set
after normalization, never for an individual adapter. An adapter cannot see the
other two boards and so cannot make that call.

## Commands

Postgres runs from `docker-compose.yml` at the project root, on host port
**5432**. This machine has no `docker compose` plugin, so use the standalone
binary:

```bash
docker-compose up -d postgres   # postgres://jobseeker:jobseeker@localhost:5432/jobseeker
```

For the API, see `api/CLAUDE.md`; the short version:

```bash
cd api && npm install && npm run dev
```

The frontend does not exist yet:

```bash
cd frontend && npm install && npm run dev   # intended shape, not yet real
```
