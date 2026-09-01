# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status: pre-scaffold

`api/` and `frontend/` are empty directories. There is no source, no
`package.json`, no schema. Everything below is a **decision**, not an
observation of existing code — nothing here has been built or verified.

Once the scaffold exists, replace the Commands section with commands you have
actually run, and rewrite Architecture from the code rather than from this file.

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
- alerts, notifications, or a scheduler

These are excluded on purpose, not forgotten. Do not add them because they seem
like the obvious next step — ask first.

## Architecture

The one seam that matters: **source adapters.** Each job board is a single
adapter behind a common interface, and the interface returns normalized
postings.

How an adapter fetches is undecided — some sources have real APIs, others will
need scraping. That decision stays *inside* the adapter. Nothing outside an
adapter may assume HTML, or JSON, or a browser, or a rate limit shape. Adding a
source should mean adding one file and registering it, and touching nothing
else.

Deduplication runs **after** normalization, across the merged result set — not
inside individual adapters. The same job posted to three boards is one posting;
an adapter cannot see the other two and so cannot make that call.

## Commands

Postgres runs from `docker-compose.yml` at the project root, on host port
**5434** — 5432 and 5433 are already taken by other projects in `~/www`:

```bash
docker compose up -d postgres   # postgres://jobseeker:jobseeker@localhost:5434/jobseeker
```

The rest is intended shape, not yet verified — neither of these runs today:

```bash
cd api && npm install && npm run dev
cd frontend && npm install && npm run dev
```
