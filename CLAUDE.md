# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

`api/` has the sources CRUD API, the ingestion pipeline, and `GET /postings` in
front of Postgres. Scraping runs only on request — there is no schedule yet.
Its commands, layout, and layering rules live in **`api/CLAUDE.md`**.
`frontend/` has a working sources screen — full CRUD against `/sources` — and
a working postings screen: a filterable, paged feed over `GET /postings`. Its
commands and conventions live in **`frontend/CLAUDE.md`**.

Each subproject owns its own `CLAUDE.md`, and Claude Code loads them
automatically when it touches files in that directory. There is no import
linking them on purpose — this file stays cross-cutting, so API detail belongs
in `api/CLAUDE.md`, not here.

## What it is

Aggregates job postings from multiple sources into one searchable place.
**Multi-user**: every user owns their own sources, blocklists and postings, and
no data is shared between users. Self-hosted.

## Stack

- `api/` — Node + TypeScript
- `frontend/` — React + Vite + TypeScript + Ant Design
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

The one seam that matters: **a source is a database row, not a code file.** One
generic adapter reads the row — a listing URL plus CSS selectors — so adding a
job board is a `POST /sources`, never a deploy. How the adapter fetches stays
inside the adapter; nothing outside it may assume HTML, JSON, or a rate-limit
shape.

**Duplicate handling is settled.** One row per source, keyed on the posting's
detail URL. A re-seen posting from the same source is assumed unchanged and
only has its `last_seen_at` advanced. Postings are *not* collapsed across
sources, and the API does not group them — the same job on three boards is
three results. See
`docs/superpowers/specs/2026-09-01-job-sources-design.md`.

What still holds either way: any collapsing is a job for the merged result set
after normalization, never for an individual adapter. An adapter cannot see the
other two boards and so cannot make that call.

The adapter is two phases — list, then fetch each detail page — because the
title blocklist has to run before a detail fetch and an already-stored posting
must never be re-fetched. Those decisions need the database, so the ingestion
service drives the loop and the adapter stays a pure HTML reader. See
`docs/superpowers/specs/2026-09-01-job-ingestion-design.md`.

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

For the frontend, see `frontend/CLAUDE.md`; the short version:

```bash
cd frontend && npm install && npm run dev   # http://localhost:5173
```
