# CLAUDE.md — frontend/

We use ant design for frontend.
This version may contain breaking changes. The component APIs, conventions, and file structure may differ from what is included in your training data. Before writing any code, please read https://ant.design/docs/react/for-agents.md and https://raw.githubusercontent.com/ant-design/ant-design-cli/main/skills/antd/SKILL.md, pay attention to deprecation warnings, and follow the instructions to use Ant Design.

## Status

`/sources` is a working screen: it lists, creates, edits, deletes and toggles
sources against the API. `/postings` is a working screen too: a feed you triage
— dense table, source filter, load-more paging, and the scraped description in
a modal. See `docs/superpowers/specs/2026-09-02-frontend-postings-page-design.md`.

`src/services/client.ts` is the only file that calls `fetch`. It owns the `/api`
prefix, the `X-User-Id` header (from `VITE_USER_ID` — copy `.env.example` to
`.env.local`) and the `ApiError` every caller catches. See
`docs/superpowers/specs/2026-09-02-frontend-sources-page-design.md`.

Six things a future cleanup pass should not "fix" without reading the comment
at the site first:

- `SourcesPage.tsx` and `SourceFormModal.tsx` each carry an
  `eslint-disable-next-line react-hooks/set-state-in-effect`, and
  `SourcesPage.tsx` also carries one for `react-hooks/refs`. Each is a
  documented false positive — `eslint-plugin-react-hooks` v7's compiler-derived
  rules are strict about refs and effects and cannot see the reasoning
  explained at each site.
- `load()` in `SourcesPage.tsx` resets its own `loading`/`error` and tags each
  call with a request id so an out-of-order response is dropped. It is
  deliberately safe to call from anywhere (mount, Retry, post-mutation
  reload); call sites must not reintroduce their own resets.
- **`load()` in `PostingsPage.tsx` resets the feed whenever `sourceId`
  changes**, and it does so through its own `useCallback` dependency rather
  than a separate effect: `load` closes over `sourceId`, so a filter change
  produces a new `load`, re-runs the effect that depends on it, and refetches
  at `offset: 0`. Do not add a reset effect beside it — two mechanisms would
  race to do one job. Appending across a filter change is what this prevents,
  and it shows up as a list mixing two sources.
- **Appending in `PostingsPage.tsx` dedupes by `id`, on purpose.** Ingestion
  inserts at the top of `first_seen_at DESC` — on demand today, and on a
  30-minute schedule once that lands — so an offset window re-serves rows
  already on screen and duplicates appear mid-list without it. The converse —
  a shift large enough to skip a row — is not fixable with offset paging and
  is knowingly accepted.
- **A posting's `description` is never rendered as HTML.** It is scraped from a
  third-party page; `dangerouslySetInnerHTML` there would let any job board run
  script in this app. `PostingDescriptionModal` renders it as text with
  `pre-wrap`.
- **The error `Alert` renders *above* a table that stays mounted, and a failed
  *replace* clears the feed while a failed *append* does not.** `/postings`
  deliberately diverges from `/sources` here, which replaces its table with the
  Alert. Two rules, and both are load-bearing: a failed "Load more" must leave
  the rows already on screen intact (they belong to the current filter), so the
  table cannot be unmounted by an error; but a failed reload — a filter switch,
  say — must clear `postings`, `total` and `offset`, because those rows belong
  to the *previous* query and showing them under the new filter asserts
  something false. The clear lives inside `load`'s request-id guard so a
  superseded response cannot blank a newer one's rows. The table is hidden only
  when there is an error and no rows at all, which is what keeps a failed first
  load from claiming "No postings yet".

## Commands

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # tsc -b && vite build
npm run typecheck
npm run lint         # eslint, flat config
npm run format       # prettier --write .
```

There is **no test runner**. `api/` uses Vitest; the frontend adds one when it
has logic worth testing, not before.

## Stack

React 19, Vite 7, TypeScript, Ant Design 6 with `@ant-design/icons` 6,
react-router 8, ESLint 9 (flat) + Prettier.

Three version facts that will bite you:

- **`react-router`, not `react-router-dom`.** Since v7 the one package exports
  `BrowserRouter`, `Routes`, `Route`, `Outlet`, `Navigate`, `NavLink` and the
  hooks. `react-router-dom` is not installed.
- **antd and `@ant-design/icons` move together.** Icons 6 is not compatible
  with antd 5 and vice versa. Upgrade both or neither.
- **antd 6 `Menu` takes `items`.** Children are deprecated. More broadly, run
  `npx @ant-design/cli lint ./src` after touching antd code.

## Layout

```
src/
  main.tsx                  ConfigProvider > App > BrowserRouter > routes
  services/                 client.ts (fetch, ApiError), sources.ts, postings.ts
  components/AppLayout.tsx      Header, Sider menu, Content with <Outlet />
  components/SourceFormModal.tsx  create/edit modal for one source
  components/PostingDescriptionModal.tsx  one posting's description, as text
  components/sourceForm.ts        validation rules, defaults, toInput/toFormValues/diffInput
  pages/                    one component per route
```

`main.tsx` is the only place providers are composed, and it owns the route
table. `pages/` is one file per route; `components/` is everything shared.

`src/services/` is the boundary. Components call the functions in `sources.ts`
and `postings.ts` and catch `ApiError`; nothing above that layer touches
`fetch` or knows the header exists.

## The `/api` prefix is a dev-server fiction

`vite.config.ts` proxies `/api` to `http://localhost:3000` and strips the
prefix, so the frontend calls `/api/postings` and Fastify sees `/postings`.
Two consequences:

- The API needs **no CORS** — every request is same-origin. `@fastify/cors`
  is not installed and should stay that way.
- **A deployment has to reproduce the rewrite** — a reverse proxy in front of
  both, or the same rule in whatever serves `dist/`. Nothing in the built
  assets carries it.
- **A deployment also has to fall back to `index.html` for unknown paths.**
  `main.tsx` uses `BrowserRouter`, so a direct hit on `/postings` is a request
  the static server has never heard of. `npm run dev` and `npm run preview`
  both serve that fallback for free, which is exactly why it will not surface
  until deploy day.

## The API is the whole contract

No imports from `api/` — not a type, not a constant, not a schema. When this
app needs the shape of a posting it declares that shape itself or reads the
OpenAPI document the API publishes at `/docs`.
