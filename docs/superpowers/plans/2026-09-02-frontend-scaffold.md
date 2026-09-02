# Frontend Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `frontend/` from a directory holding one `CLAUDE.md` into a React + Vite + TypeScript app that boots, renders an Ant Design shell with two working routes, and knows how to reach the API in dev — without making a single request.

**Architecture:** Vite's `react-ts` template assembled by hand, then Ant Design 6 and `react-router` added on top. `main.tsx` composes `ConfigProvider → App → BrowserRouter → routes`; `AppLayout` renders an antd `Layout` with a `Menu` in the sider and `Outlet` in the content; two placeholder pages render `Empty`. The Vite dev server proxies `/api` to the Fastify API on port 3000, stripping the prefix, so no CORS is needed on either side.

**Tech Stack:** Node 22, Vite 7, React 19, TypeScript, Ant Design 6, `@ant-design/icons` 6, react-router 8, ESLint 9 (flat), Prettier.

**Spec:** `docs/superpowers/specs/2026-09-02-frontend-scaffold-design.md`

## Global Constraints

- **Exact dependency versions to install:** `antd@^6` (6.6.2 current), `@ant-design/icons@^6`, `react@^19`, `react-dom@^19`, `react-router@^8` (8.3.1 current).
- **Correction to the spec:** the spec says `react-router ^7`. The current major is **8** (8.3.1) and its API for everything used here is identical. Install **8**. If a reviewer wants 7, that is a deliberate reversal, not a typo to fix silently.
- **Deviation from the spec: Vite 7, not 8.** `npm create vite@latest` now
  scaffolds an oxlint-based template, so `create-vite@8.3.0` was pinned instead
  to get the ESLint 9 flat config this plan requires — and that template ships
  a Vite 7 project (7.3.6 installed). Moving to Vite 8 would pull in
  `@vitejs/plugin-react` v6, whose peer dependencies (`oxc-transform-react`,
  `@rolldown/plugin-babel`, `babel-plugin-react-compiler`) are a different
  bundler toolchain this plan never considered. Install **Vite 7**. If a
  reviewer wants 8, that is a deliberate toolchain change, not a typo to fix
  silently.
- **One package, not two.** Import `BrowserRouter`, `Routes`, `Route`, `Outlet`, `Navigate`, `NavLink`, `useLocation` from `react-router`. Do **not** install or import `react-router-dom` — since v7 the single `react-router` package exports all of these. Verified against 8.3.1.
- **antd 6 API rules that differ from v5 and from training data** (verified via `npx @ant-design/cli migrate 5 6`):
  - `Menu` takes an `items` array. **`Menu` children are deprecated** — never write `<Menu><Menu.Item/></Menu>`.
  - `Button`'s `type` prop is split into `color` + `variant`. `type="primary"` still works as an alias; `type="text"` is still valid. New code in this plan uses `variant`/`color` where it uses `Button` at all.
  - `@ant-design/icons@6` is **not** compatible with antd 5, and antd 6 is not compatible with icons 5. Both are v6 or the build breaks.
  - Do **not** install `@ant-design/v5-patch-for-react-19`. It is unnecessary in v6.
  - antd 6 emits CSS variables by default and requires React >= 18. Both are satisfied.
  - No `import 'antd/dist/reset.css'` line and no `antd/dist/antd.css` — v5+ is CSS-in-JS and the template's `index.css` is the only stylesheet.
- **Query before writing.** Per `frontend/CLAUDE.md`, run `npx @ant-design/cli info <Component> --version 6 --format json` before using an antd component whose props you are not reading off this plan. A v5 pattern that happens to compile is not evidence it is current.
- **`frontend/` is independent of `api/`.** Its own `package.json`, its own `node_modules`, its own configs. Nothing is hoisted to the repo root and no file is imported across the boundary — not a type, not a constant, not a schema.
- **No HTTP requests in this plan.** No `fetch`, no API client, no `X-User-Id`. The proxy is configured and left unused.
- **No test runner.** `api/` runs Vitest; the frontend deliberately does not yet, because a scaffold has no logic worth unit-testing and an empty `npm test` is noise. **Consequence for this plan: the usual red-green TDD cycle does not apply.** Each task's verification is instead an explicit, runnable command whose output you must read before checking the box — `npm run build`, `npm run lint`, `npx antd lint`, and a manual dev-server check. Where a step says "expected", that is the output you are confirming, not a formality.
- **Prettier config matches `api/` verbatim:** `{ "semi": false, "singleQuote": true, "trailingComma": "all", "printWidth": 80 }`. Same style across the repo, separate config files — that is the "no shared tooling" rule, not a contradiction of it.
- **Commit after every task.** Do not batch.

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/package.json` | deps + the `dev`/`build`/`preview`/`lint`/`format`/`typecheck` scripts |
| `frontend/vite.config.ts` | react plugin, and the `/api` → `localhost:3000` dev proxy |
| `frontend/eslint.config.js` | template flat config + `eslint-config-prettier` last |
| `frontend/.prettierrc` | formatting, copied from `api/` |
| `frontend/.prettierignore` | keep `dist/` and `node_modules/` out of `format` |
| `frontend/.gitignore` | `node_modules`, `dist` |
| `frontend/index.html` | page title |
| `frontend/src/main.tsx` | the one place providers are composed; owns the route table |
| `frontend/src/components/AppLayout.tsx` | the chrome: header, sider menu, content `Outlet`. Knows the nav items; knows nothing about page content |
| `frontend/src/pages/SourcesPage.tsx` | placeholder for the sources screen |
| `frontend/src/pages/PostingsPage.tsx` | placeholder for the postings screen |
| `frontend/CLAUDE.md` | modified: record what now exists and how to run it |
| `CLAUDE.md` (repo root) | modified: `frontend/` is no longer an empty directory |

`pages/` is one component per route; `components/` is everything shared. Trivially small now, and it exists so the first real screen has an obvious home.

---

### Task 1: Scaffold the project and its tooling

Deliverable: `frontend/` installs, builds, lints and formats clean, with the dev proxy configured. Still the stock Vite counter page — no antd, no routing yet. A reviewer can reject this task on tooling grounds alone, independent of Task 2.

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/tsconfig.app.json`, `frontend/tsconfig.node.json`, `frontend/index.html`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/index.css`, `frontend/src/App.css`, `frontend/src/vite-env.d.ts`, `frontend/eslint.config.js`, `frontend/.gitignore` — all from the Vite template
- Create: `frontend/.prettierrc`, `frontend/.prettierignore`
- Modify: `frontend/vite.config.ts` (add the proxy), `frontend/eslint.config.js` (add prettier), `frontend/package.json` (add scripts)
- Preserve: `frontend/CLAUDE.md` — it already exists and **must not be deleted by the scaffolder**

**Interfaces:**
- Consumes: nothing
- Produces: a working `npm run dev` / `build` / `lint` / `format` / `typecheck` in `frontend/`, and the `/api` proxy that no later task in this plan uses

- [ ] **Step 1: Scaffold into a temp directory**

`npm create vite` refuses to write into a non-empty directory without an interactive prompt, and `frontend/` already contains `CLAUDE.md`. So scaffold elsewhere and copy in.

```bash
cd /tmp && rm -rf jobseeker-vite-scaffold
npm create vite@latest jobseeker-vite-scaffold -- --template react-ts
```

Expected: `Scaffolding project in /tmp/jobseeker-vite-scaffold...` and a `Done.` line. No `npm install` yet.

- [ ] **Step 2: Copy the template into `frontend/`, keeping `CLAUDE.md`**

```bash
cd /Users/ykravchenko/www/JobSeeker/frontend
cp -R /tmp/jobseeker-vite-scaffold/. .
rm -rf /tmp/jobseeker-vite-scaffold
ls -a
```

Expected: `CLAUDE.md` is still listed, alongside `package.json`, `index.html`, `src/`, `vite.config.ts`, `eslint.config.js`, `.gitignore`, and the tsconfigs. If `CLAUDE.md` is gone, `git checkout frontend/CLAUDE.md` and redo this step — `cp -R src/. dest` copies contents without clobbering siblings, so it should not happen.

- [ ] **Step 3: Install runtime and tooling dependencies**

```bash
cd /Users/ykravchenko/www/JobSeeker/frontend
npm install
npm install antd@^6 @ant-design/icons@^6 react-router@^8
npm install -D prettier eslint-config-prettier
```

Expected: no `ERESOLVE` peer-dependency errors. Then confirm the majors landed as intended:

```bash
node -p "const d=require('./package.json').dependencies; JSON.stringify(d,null,2)"
```

Expected: `antd` and `@ant-design/icons` both `^6.x`, `react` and `react-dom` `^19.x`, `react-router` `^8.x`. There must be **no** `react-router-dom` and **no** `@ant-design/v5-patch-for-react-19`.

- [ ] **Step 4: Add the dev proxy to `vite.config.ts`**

Replace the whole file with:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The `/api` prefix exists only here. The Fastify API serves `/sources` and
// `/postings` unprefixed, so the rewrite strips it back off. Because every
// browser request is same-origin, the API needs no CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
```

Note: the template may import `@vitejs/plugin-react` or `@vitejs/plugin-react-swc` depending on what `create-vite` shipped. Check the original import line before overwriting and keep whichever package is actually in `devDependencies`; the spec chose the non-SWC plugin, so if the template gave you `-swc`, replace it:

```bash
npm uninstall @vitejs/plugin-react-swc && npm install -D @vitejs/plugin-react
```

- [ ] **Step 5: Add the Prettier config and ignore file**

`frontend/.prettierrc`:

```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 80
}
```

`frontend/.prettierignore`:

```
node_modules
dist
package-lock.json
```

- [ ] **Step 6: Turn off ESLint rules that fight Prettier**

Open `frontend/eslint.config.js`. Add the import at the top and append the config **last** in the exported array, so it wins over the rules above it:

```js
import eslintConfigPrettier from 'eslint-config-prettier'
```

Then add `eslintConfigPrettier` as the final element of the array passed to `defineConfig` / exported by the file. Example shape — match whatever the template actually generated rather than pasting this over it:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    // ...template config for **/*.{ts,tsx}...
  },
  eslintConfigPrettier,
])
```

If the import errors at lint time, the installed `eslint-config-prettier` is v10+ and wants the explicit flat entrypoint: `import eslintConfigPrettier from 'eslint-config-prettier/flat'`.

- [ ] **Step 7: Set the scripts in `package.json`**

Replace the `"scripts"` block with:

```json
{
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "typecheck": "tsc -b",
  "lint": "eslint .",
  "lint:fix": "eslint . --fix",
  "format": "prettier --write .",
  "format:check": "prettier --check ."
}
```

There is deliberately no `test` script — see Global Constraints.

- [ ] **Step 8: Format, then verify the toolchain end to end**

```bash
cd /Users/ykravchenko/www/JobSeeker/frontend
npm run format
npm run lint
npm run build
```

Expected, in order: Prettier lists the files it rewrote; `eslint .` exits 0 printing nothing; `tsc -b && vite build` reports `✓ built in ...` and writes `dist/`. All three must pass before continuing. If `lint` reports errors in template files, fix them rather than adding ignores.

- [ ] **Step 9: Confirm `.gitignore` covers the build output**

```bash
cat frontend/.gitignore
```

Expected: entries for `node_modules` and `dist` (the Vite template supplies both). If either is missing, add it. Then confirm nothing unwanted is staged-able:

```bash
cd /Users/ykravchenko/www/JobSeeker && git status --short frontend/
```

Expected: `frontend/` source and config files listed; **no** `node_modules/` and no `dist/`.

- [ ] **Step 10: Commit**

```bash
cd /Users/ykravchenko/www/JobSeeker
git add frontend/
git commit -m "chore(frontend): scaffold Vite + React + TS with prettier and the dev proxy"
```

---

### Task 2: The Ant Design shell and its two routes

Deliverable: `npm run dev` serves a layout with a working sider menu; `/sources` and `/postings` each render their placeholder inside it, and `/` lands on `/postings`.

**Files:**
- Modify: `frontend/src/main.tsx` (replace the template's contents entirely)
- Create: `frontend/src/components/AppLayout.tsx`
- Create: `frontend/src/pages/PostingsPage.tsx`
- Create: `frontend/src/pages/SourcesPage.tsx`
- Delete: `frontend/src/App.tsx`, `frontend/src/App.css`, `frontend/src/assets/react.svg`
- Modify: `frontend/index.html` (title), `frontend/src/index.css` (drop the template's centering)

**Interfaces:**
- Consumes: from Task 1 — antd 6, `@ant-design/icons` 6, `react-router` 8, and the working `build`/`lint` scripts
- Produces:
  - `AppLayout` — default export, `React.FC`, takes no props, renders `<Outlet />` in its content area. Later tasks nest routes under it.
  - `PostingsPage`, `SourcesPage` — default exports, `React.FC`, take no props.
  - The route table lives in `main.tsx`: `/` redirects to `/postings`; `/postings` and `/sources` are children of the `AppLayout` route.

- [ ] **Step 1: Write the postings placeholder**

`frontend/src/pages/PostingsPage.tsx`:

```tsx
import { Empty, Typography } from 'antd'

const PostingsPage = () => (
  <>
    <Typography.Title level={3}>Postings</Typography.Title>
    <Empty description="No postings loaded yet" />
  </>
)

export default PostingsPage
```

- [ ] **Step 2: Write the sources placeholder**

`frontend/src/pages/SourcesPage.tsx`:

```tsx
import { Empty, Typography } from 'antd'

const SourcesPage = () => (
  <>
    <Typography.Title level={3}>Sources</Typography.Title>
    <Empty description="No sources configured yet" />
  </>
)

export default SourcesPage
```

- [ ] **Step 3: Write the layout**

`frontend/src/components/AppLayout.tsx`. Note `Menu` takes `items` — children are deprecated in antd 6. `selectedKeys` is driven by the URL so a direct navigation to `/sources` highlights the right entry, and `NavLink` (not `onClick` + `useNavigate`) does the navigating so middle-click and copy-link behave.

```tsx
import { DatabaseOutlined, ProfileOutlined } from '@ant-design/icons'
import { Layout, Menu, theme } from 'antd'
import { NavLink, Outlet, useLocation } from 'react-router'

const { Header, Sider, Content } = Layout

const navItems = [
  {
    key: '/postings',
    icon: <ProfileOutlined />,
    label: <NavLink to="/postings">Postings</NavLink>,
  },
  {
    key: '/sources',
    icon: <DatabaseOutlined />,
    label: <NavLink to="/sources">Sources</NavLink>,
  },
]

const AppLayout = () => {
  const { pathname } = useLocation()
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken()

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[pathname]}
          items={navItems}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            paddingInline: 24,
            background: colorBgContainer,
            fontSize: 18,
            fontWeight: 600,
          }}
        >
          JobSeeker
        </Header>
        <Content
          style={{
            margin: 24,
            padding: 24,
            background: colorBgContainer,
            borderRadius: borderRadiusLG,
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}

export default AppLayout
```

- [ ] **Step 4: Compose the providers and the route table**

Replace `frontend/src/main.tsx` entirely. The nesting order is load-bearing: `ConfigProvider` outermost so theme and locale reach everything including portalled popups, antd's `App` inside it so `message`/`notification` get context instead of falling back to the static methods v6 discourages, then the router.

```tsx
import { App as AntdApp, ConfigProvider } from 'antd'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'

import AppLayout from './components/AppLayout'
import PostingsPage from './pages/PostingsPage'
import SourcesPage from './pages/SourcesPage'
import './index.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root not found in index.html')
}

createRoot(rootElement).render(
  <StrictMode>
    {/* Stock theme on purpose. Tokens go in this object when we pick any. */}
    <ConfigProvider theme={{ token: {} }}>
      <AntdApp>
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<Navigate to="/postings" replace />} />
              <Route path="postings" element={<PostingsPage />} />
              <Route path="sources" element={<SourcesPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  </StrictMode>,
)
```

- [ ] **Step 5: Remove the template's leftovers**

`App.tsx` and its CSS are now unreferenced, and `index.css` centers the body in a way that fights a full-height `Layout`.

```bash
cd /Users/ykravchenko/www/JobSeeker/frontend
rm -f src/App.tsx src/App.css src/assets/react.svg
rmdir src/assets 2>/dev/null || true
```

Then replace `frontend/src/index.css` with:

```css
:root {
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}

body {
  margin: 0;
}
```

And set the tab title in `frontend/index.html` — change the `<title>` element to:

```html
<title>JobSeeker</title>
```

- [ ] **Step 6: Verify it type-checks, lints and builds**

```bash
cd /Users/ykravchenko/www/JobSeeker/frontend
npm run format
npm run lint
npm run build
```

Expected: `eslint .` exits 0 with no output; the build reports `✓ built in ...`. A `Cannot find module './App'` here means Step 5 ran before Step 4 — re-apply Step 4's `main.tsx`.

- [ ] **Step 7: Check for deprecated antd usage**

```bash
cd /Users/ykravchenko/www/JobSeeker/frontend
npx -y @ant-design/cli@latest lint ./src --format json
```

Expected: no findings. If it flags anything — most likely a `Menu` children pattern or a `Button` `type` prop — fix it against `npx @ant-design/cli info <Component> --version 6 --format json` rather than suppressing it.

- [ ] **Step 8: Verify in the browser**

```bash
cd /Users/ykravchenko/www/JobSeeker/frontend
npm run dev
```

Then confirm each of these by hand, and read the browser console while doing it:

1. `http://localhost:5173/` redirects to `/postings` and the URL bar shows `/postings`.
2. The sider shows **Postings** and **Sources**; **Postings** is highlighted.
3. Clicking **Sources** switches the content to the sources placeholder, the URL becomes `/sources`, the highlight moves, and **the page does not fully reload** (the browser's reload spinner never appears).
4. Loading `http://localhost:5173/sources` directly renders the sources page with **Sources** highlighted.
5. The sider's collapse trigger collapses and expands it.
6. **The console is free of React and antd warnings** — in particular no "findDOMNode", no antd deprecation notice, and no key warnings.

Stop the dev server when done.

- [ ] **Step 9: Commit**

```bash
cd /Users/ykravchenko/www/JobSeeker
git add frontend/
git commit -m "feat(frontend): add the antd layout shell with postings and sources routes"
```

---

### Task 3: Record what now exists

Deliverable: the two `CLAUDE.md` files describe the frontend as it is rather than as a plan. This is beyond the spec's "Done means" list, and is included because the root `CLAUDE.md` currently asserts something this plan makes false — leaving it is a documentation bug introduced by Task 1.

**Files:**
- Modify: `frontend/CLAUDE.md`
- Modify: `CLAUDE.md` (repo root)

**Interfaces:**
- Consumes: the finished Tasks 1 and 2
- Produces: nothing code depends on

- [ ] **Step 1: Extend `frontend/CLAUDE.md`**

Keep the existing Ant Design paragraph exactly as it is — it is the standing instruction to check the docs before writing antd code — and append below it:

```markdown
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

React 19, Vite 8, TypeScript, Ant Design 6 with `@ant-design/icons` 6,
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
```

- [ ] **Step 2: Correct the root `CLAUDE.md`**

In the `## Status` section, the sentence *"`frontend/` is still an empty directory; what is said about it here is a decision, not an observation."* is now false. Replace it with:

```markdown
`frontend/` is scaffolded: Vite + React + TypeScript + Ant Design, an antd
layout shell, and two placeholder routes. It makes no API calls yet. Its
commands and conventions live in **`frontend/CLAUDE.md`**.
```

In the `## Stack` section, change the frontend line to name the UI kit:

```markdown
- `frontend/` — React + Vite + TypeScript + Ant Design
```

In `## Commands`, replace the "The frontend does not exist yet" block and its comment with:

```bash
cd frontend && npm install && npm run dev   # http://localhost:5173
```

- [ ] **Step 3: Verify the claims are true**

Re-read both files and check every factual claim against the repo — the script names against `frontend/package.json`, the file paths against `src/`, the proxy description against `vite.config.ts`. A `CLAUDE.md` that is wrong is worse than one that is missing.

```bash
cd /Users/ykravchenko/www/JobSeeker/frontend
node -p "JSON.stringify(require('./package.json').scripts,null,2)"
ls -R src
```

- [ ] **Step 4: Commit**

```bash
cd /Users/ykravchenko/www/JobSeeker
git add frontend/CLAUDE.md CLAUDE.md
git commit -m "docs: describe the frontend scaffold in both CLAUDE.md files"
```

---

## Final verification

Run from a clean checkout of `frontend/` to prove the scaffold stands on its own:

```bash
cd /Users/ykravchenko/www/JobSeeker/frontend
rm -rf node_modules dist
npm install
npm run typecheck
npm run lint
npm run format:check
npm run build
npx -y @ant-design/cli@latest lint ./src --format json
```

Every command must exit 0. This is the spec's "Done means" list, with the manual dev-server checks in Task 2 Step 8 covering the rest.
