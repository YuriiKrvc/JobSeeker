# Frontend scaffold: Vite, React, Ant Design, and a routed shell

Date: 2026-09-02
Status: approved design, not yet implemented

## Problem

`frontend/` contains one file: its own `CLAUDE.md`, which says the project uses
Ant Design and nothing else. The root `CLAUDE.md` names the stack — React, Vite,
TypeScript — but calls that a decision rather than an observation, and it does
not mention Ant Design at all. There is no `package.json`, no build, no way to
see whether any of it holds together.

This slice makes the frontend real and stops there. The project boots, Ant
Design renders, two routes resolve, and the dev server knows how to reach the
API. **Nothing calls the API yet.** That is the point of the boundary: a scaffold
that builds and lints clean is a reviewable unit, and the first screen that
actually fetches data is a separate decision about loading states, error
handling, and server-state caching that should not be smuggled in underneath a
`npm create vite`.

## Decisions made, and the ones deferred

Settled here:

- **Vite's `react-ts` template, assembled by hand.** Not Ant Design Pro, which
  brings UmiJS conventions and a large amount of code nobody asked for, and not
  the SWC variant — the Babel plugin is one less toolchain in the tree and this
  app is far too small for HMR speed to be the deciding factor.
- **Ant Design 6** (6.6.2 at time of writing), the current major with
  first-class React 19 support. Choosing v5 would mean shipping a version behind
  and planning a migration; the cost of v6 is that it is newer than the model's
  training data, which is exactly what `frontend/CLAUDE.md` exists to warn about.
- **`react-router` and nothing else.** No TanStack Query, no client-state store.
  Both are plausible later — server-state caching in particular, for an app that
  is almost entirely "read the API" — but neither has a consumer in a scaffold,
  and a dependency with no consumer is a decision made too early.
- **Vite's default ESLint config plus Prettier. No test runner.** `api/` runs
  Vitest, ESLint 9 flat and Prettier; the frontend matches on lint and format
  but skips the test runner until there is logic worth testing. A `npm test`
  that runs zero tests is noise, not parity.

Deferred on purpose, and not to be quietly resolved during implementation:

- How the frontend authenticates. `X-User-Id` is the API's stand-in and the
  frontend has no story for it yet. It belongs to the first slice that makes a
  request.
- Theme tokens, colors, dark mode. `ConfigProvider` goes in with the stock
  theme so tokens have an obvious home; picking any is out of scope.
- Anything in the root `CLAUDE.md`'s excluded list — relevance scoring,
  application tracking, alerts.

## Independence from `api/`

The root `CLAUDE.md` rule holds without qualification: two projects, no shared
source, no shared tooling, the REST API is the entire contract. `frontend/` gets
its own `package.json`, its own `node_modules`, its own ESLint and Prettier
configs. Nothing is hoisted to the repo root, and no file is imported across the
boundary — not a type, not a constant, not a Zod schema. When the frontend needs
to know the shape of a posting, it declares that shape itself or reads it from
the OpenAPI document the API already publishes at `/docs`.

## The dev proxy

The dev server proxies `/api` to `http://localhost:3000`, stripping the prefix:

```
browser  GET /api/postings
  └─> vite dev server (5173)
        └─> GET /postings  →  fastify (3000)
```

Two consequences worth stating, since the alternative was a `VITE_API_URL`
pointing straight at port 3000:

- **The API needs no CORS.** Every request the browser makes is same-origin.
  `@fastify/cors` is not installed and this design does not install it.
- **The `/api` prefix is a frontend-only fiction.** It exists in the dev server
  and nowhere else; the API's routes are `/sources` and `/postings`, unprefixed,
  and the rewrite is what reconciles them. A production deployment has to
  reproduce this — a reverse proxy in front of both, or the same rewrite in
  whatever serves the built assets. That is a deployment question this spec does
  not answer, but it must not come as a surprise later.

## Layout

```
frontend/
  package.json
  vite.config.ts        react plugin + the dev proxy
  tsconfig.json         from the template
  eslint.config.js      template config + eslint-config-prettier
  .prettierrc
  .gitignore            node_modules, dist
  index.html
  src/
    main.tsx            ConfigProvider → App → BrowserRouter → routes
    components/
      AppLayout.tsx     antd Layout: Header, Sider with Menu, Outlet
    pages/
      SourcesPage.tsx   placeholder
      PostingsPage.tsx  placeholder
```

`pages/` holds one component per route and `components/` holds everything
shared. The split is trivially small now and exists so that the first real
screen has somewhere obvious to go.

## The shell

`main.tsx` composes four things in one order, and the order matters:
`ConfigProvider` outermost so theme and locale reach everything, antd's `App`
component inside it so `message` and `notification` get the context they need
rather than falling back to the static methods v6 discourages, `BrowserRouter`
inside that, and the route table innermost.

`AppLayout` renders an antd `Layout`: a `Header` with the product name, a
`Sider` whose `Menu` links `/sources` and `/postings`, and a `Content`
containing `Outlet`. `/` redirects to `/postings`. Both pages render an antd
`Empty`. That is the whole UI, and it is enough — it exercises the theme,
routing, and at least four antd components together, which is what a scaffold is
for.

## Working against a version newer than training data

`frontend/CLAUDE.md` is explicit that antd 6's APIs may differ from what the
model knows, and this spec inherits that as a working rule rather than a
suggestion: **query `@ant-design/cli` for a component's API before writing it,
not after.** `antd info <Component> --format json` for props,
`antd demo <Component> <name> --format json` for a known-good usage, and
`antd lint ./src --format json` once the source exists, to catch anything
deprecated that slipped through. A v5 pattern recalled from memory that happens
to compile is not evidence it is current.

## Done means

- `npm install` succeeds from a clean `frontend/`.
- `npm run build` produces `dist/` with no TypeScript errors.
- `npm run lint` is clean; `npm run format` leaves no diff.
- `npx antd lint ./src` reports no deprecated usage.
- `npm run dev` boots, `/sources` and `/postings` both render inside the layout,
  and the sider menu navigates between them without a full page load.

Not in scope, and their absence is not a defect: any HTTP request, any test, any
theme token, and any handling of `X-User-Id`.

## Amendments

**2026-09-02:** This design did not settle on a Vite major version, but the
implementation plan that followed it named Vite 8, and the tree ships Vite
7.3.6 instead. `npm create vite@latest` now scaffolds an oxlint-based
template, so `create-vite@8.3.0` was pinned to get the ESLint 9 flat config
this spec requires — and that template ships a Vite 7 project. Moving to Vite
8 would require `@vitejs/plugin-react` v6, whose peer dependencies
(`oxc-transform-react`, `@rolldown/plugin-babel`,
`babel-plugin-react-compiler`) are a different bundler toolchain this design
never considered. Treat Vite 7 as the settled version unless a future design
explicitly revisits the toolchain.
