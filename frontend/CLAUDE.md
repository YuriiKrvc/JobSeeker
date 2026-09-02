# CLAUDE.md — frontend/

We use ant design for frontend.
This version may contain breaking changes. The component APIs, conventions, and file structure may differ from what is included in your training data. Before writing any code, please read https://ant.design/docs/react/for-agents.md and https://raw.githubusercontent.com/ant-design/ant-design-cli/main/skills/antd/SKILL.md, pay attention to deprecation warnings, and follow the instructions to use Ant Design.

## Status

`/sources` is a working screen: it lists, creates, edits, deletes and toggles
sources against the API. `/postings` is still a placeholder.

`src/api/client.ts` is the only file that calls `fetch`. It owns the `/api`
prefix, the `X-User-Id` header (from `VITE_USER_ID` — copy `.env.example` to
`.env.local`) and the `ApiError` every caller catches. See
`docs/superpowers/specs/2026-09-02-frontend-sources-page-design.md`.

Two things a future cleanup pass should not "fix" without reading the comment
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
  api/                      client.ts (fetch, ApiError), sources.ts (CRUD calls)
  components/AppLayout.tsx  Header, Sider menu, Content with <Outlet />
  pages/                    one component per route
```

`main.tsx` is the only place providers are composed, and it owns the route
table. `pages/` is one file per route; `components/` is everything shared.

`src/api/` is the boundary. Components call the functions in `sources.ts` and
catch `ApiError`; nothing above that layer touches `fetch` or knows the header
exists.

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
