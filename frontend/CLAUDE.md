# CLAUDE.md — frontend/

We use ant design for frontend.
This version may contain breaking changes. The component APIs, conventions, and file structure may differ from what is included in your training data. Before writing any code, please read https://ant.design/docs/react/for-agents.md and https://raw.githubusercontent.com/ant-design/ant-design-cli/main/skills/antd/SKILL.md, pay attention to deprecation warnings, and follow the instructions to use Ant Design.

## Status

Scaffold only. The app boots, renders an antd `Layout` shell, and routes
between two placeholder pages. **Nothing calls the API yet** — there is no
fetch, no API client, and no handling of `X-User-Id`. See
`docs/superpowers/specs/2026-09-02-frontend-scaffold-design.md`.

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
  components/AppLayout.tsx  Header, Sider menu, Content with <Outlet />
  pages/                    one component per route
```

`main.tsx` is the only place providers are composed, and it owns the route
table. `pages/` is one file per route; `components/` is everything shared.

## The `/api` prefix is a dev-server fiction

`vite.config.ts` proxies `/api` to `http://localhost:3000` and strips the
prefix, so the frontend calls `/api/postings` and Fastify sees `/postings`.
Two consequences:

- The API needs **no CORS** — every request is same-origin. `@fastify/cors`
  is not installed and should stay that way.
- **A deployment has to reproduce the rewrite** — a reverse proxy in front of
  both, or the same rule in whatever serves `dist/`. Nothing in the built
  assets carries it.

## The API is the whole contract

No imports from `api/` — not a type, not a constant, not a schema. When this
app needs the shape of a posting it declares that shape itself or reads the
OpenAPI document the API publishes at `/docs`.
