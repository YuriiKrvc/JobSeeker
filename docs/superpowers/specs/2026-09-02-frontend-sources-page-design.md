# Frontend sources page: the first screen that talks to the API

Date: 2026-09-02
Status: proposed, awaiting review

## Problem

`frontend/` builds, routes, and renders an Ant Design shell, and every page in
it is a placeholder. `SourcesPage.tsx` is nine lines that unconditionally render
`<Empty description="No sources configured yet" />` — it has never asked whether
any source exists.

Meanwhile `api/` has offered full sources CRUD for a while: `GET /sources`,
`GET /sources/:id`, `POST /sources`, `PATCH /sources/:id`, `DELETE /sources/:id`.
Nothing consumes it but `curl` and the Vitest suite. Adding a source today means
hand-writing a JSON body with nineteen editable fields and posting it yourself.

This slice makes `/sources` real: list, create, edit, delete, and toggle. It is
also, unavoidably, the slice that answers the three questions the scaffold spec
deferred to "the first screen that actually fetches data" — how a request is
made, how `X-User-Id` gets onto it, and what a failure looks like on screen.
Those answers are small on purpose, and they are the load-bearing part of this
document.

## What the API actually offers

Read from `api/src/routes/sources.ts` and `api/src/routes/sources.schema.ts`;
restated here so this document stands alone, and **not** imported — the API is
the whole contract, per both `CLAUDE.md` files.

A source on the wire has twenty-five fields. Nineteen are editable:

| Group | Fields |
|---|---|
| Basics | `name`, `listingUrl`, `enabled` |
| Listing page | `itemSelector`, `titleSelector`, `titleAttr`, `detailUrlSelector`, `detailUrlAttr` |
| Detail page | `descriptionSelector`, `descriptionAttr`, `companySelector`, `companyAttr`, `postedAtSelector`, `postedAtAttr` |
| Blocklists | `blockedTitleWords`, `blockedDescriptionWords` |
| Limits | `requestTimeoutMs`, `detailDelayMs`, `maxItemsPerRun` |

Six are server-owned and read-only: `id`, `lastRunAt`, `lastSuccessAt`,
`lastError`, `createdAt`, `updatedAt`. The owner is absent from the wire shape
on purpose — every source you can see is already yours.

Three facts about the contract shape the UI:

- **`null` is meaningful and distinct from omitted.** On `PATCH`, an omitted key
  leaves the column alone; an explicit `null` clears an optional selector. The
  form has to be able to express "clear this", which rules out treating an empty
  input as "don't touch it".
- **Names are unique per user**, enforced by `sources_user_name_uniq` and
  surfaced as a `409 Conflict` with the message
  `You already have a source with that name`. It is the only 409 either write
  route can produce.
- **Every request needs `X-User-Id`**, a UUID of an existing user. Missing,
  repeated, or malformed gives a `400`; a well-formed UUID for a user that does
  not exist gives a `404 No such user` — a distinction worth surfacing, because
  the two have completely different fixes.

Errors always arrive as `{ statusCode, error, message }` (`api/src/routes/http.ts`),
including the ones Fastify's own validator raises. That uniformity is what makes
a single client-side error type viable.

## Decisions

### The user id comes from a Vite env var

`import.meta.env.VITE_USER_ID`, read from `.env.local`, typed in
`src/vite-env.d.ts`, with a committed `.env.example` documenting it and
carrying the fixed bootstrap id `00000000-0000-4000-8000-000000000001` that
`api/drizzle/0001_seed_owner.sql` seeds into every environment. Changing user
means editing the file and restarting the dev server.

The alternative considered was a field in the header persisted to
`localStorage`, which is switchable at runtime and would let two users be
compared without a restart. It was rejected as premature: it builds an identity
UI on top of a header that `api/src/auth/current-user.ts` states in capitals
must never reach a deployment. When real sessions arrive, that UI is thrown
away; an env var is a one-line deletion.

If `VITE_USER_ID` is unset, the client sends no header and the API answers 400
with `Missing x-user-id header`. That is a correct and legible failure, so no
special-casing is added for it beyond a comment in `.env.example`.

### One `request()` helper, one `ApiError`

`src/api/client.ts` exports a single generic `request<T>(path, init)`. It
prefixes `/api`, sets `Content-Type: application/json` on bodied requests, sets
`X-User-Id`, and:

- returns `undefined` for `204`, which `DELETE` answers with;
- parses the error envelope on a non-2xx and throws
  `ApiError { status, error, message }`;
- falls back to a status-derived message if the body is not the expected JSON —
  a proxy failure or a dev server with no API behind it produces HTML, and the
  UI must not render "Unexpected token < in JSON".

Everything above the client catches `ApiError` and reads `.status` and
`.message`. No component touches `fetch`.

### Plain `fetch` and `useState`, no query library

The page holds `{ sources, loading, error }` in `useState`, loads in an effect,
and re-lists after every successful mutation. TanStack Query would give caching,
background refetch, and mutation invalidation for free, and it is the obvious
choice if this app grows several interdependent screens.

It is not added here for the same reason the scaffold spec left it out: one
screen, one collection, and a full re-list after a mutation is both correct and
cheap. A dependency earns its place when a second consumer appears. This
decision is expected to be revisited when `PostingsPage` gets filtering.

Re-listing rather than patching local state is a deliberate simplicity trade:
one extra round trip per mutation buys a page that cannot drift from the server,
including on the fields the server owns (`updatedAt`, and `lastError` if a
scheduled run lands mid-edit).

### The table

An antd `Table` keyed on `id`, columns:

| Column | Content |
|---|---|
| Name | Plain text |
| Listing URL | External link, `target="_blank" rel="noreferrer"`, truncated |
| Enabled | `Switch`, wired (see below) |
| Last run | `lastRunAt` as a local timestamp, or an em dash when the source has never run |
| Status | `lastError` present → error `Tag`, message in a tooltip. Else `lastSuccessAt` present → success `Tag`. Else a neutral "never run" `Tag`. |
| Actions | Edit, and Delete behind a `Popconfirm` |

`lastError` is truncated in the cell and given in full in the tooltip; the
message is an upstream scraper failure and can be long.

**The `enabled` switch writes immediately.** Flipping it sends
`PATCH { enabled }` and shows a per-row loading state on the switch. On/off is
the frequent operation — pausing a noisy board — and routing it through a
nineteen-field modal would be absurd. On failure the switch reverts and the error
is toasted; the row is not left claiming a state the server rejected.

Header: a title and an "Add source" button. Empty state stays `Empty`, but now
because the API returned zero sources rather than because the page cannot count.

### One modal, one form, both modes

`src/components/SourceFormModal.tsx` renders an antd `Form` inside a `Modal` for
both create and edit; mode is decided by whether a `source` prop is present.
A single scrolling body, with the five groups above separated by subheadings.

A `Drawer` with collapsible sections and a dedicated `/sources/:id` route were
both considered. Nineteen fields is genuinely a lot, and collapsing the optional
ones would shorten the initial view — but it would also hide the fields most
likely to need attention when a selector stops matching, and every collapse is a
click between the user and the thing they came to fix. One scroll is honest
about the size of the form. If it becomes unbearable, the fix is fewer fields or
a wizard, not a hidden panel.

The two blocklists use `Select mode="tags"` — the API takes arrays of words, and
a tag input is the closest native match. The three limits use `InputNumber` with
`min`/`max` matching the API.

Nullable selector fields left empty submit as `null`, not `''`. `''` fails the
API's `/\S/` pattern with a 400; `null` is the documented way to say "there is
no company selector on this board".

### Validation mirrors the API rules

Required fields, non-blank, max lengths, `http(s)` URL, and numeric ranges are
all declared as antd `Form` rules matching `sources.schema.ts` exactly.

This duplicates the Zod schema by hand and can drift — the real fix is
generating types and rules from the OpenAPI document at `/docs`, which is not in
scope here. It is accepted because the alternative is a form that lets a user
fill in nineteen fields and then rejects the whole thing on one flattened server
message with no field attribution. Client validation is a courtesy; the API
remains the authority, and every server 400 is still surfaced.

**Drift containment:** the rules live in one exported `const` per field group in
the modal file, not scattered inline, so a future generator has a single place
to replace. The API's exact numbers are written down in this document's table
above so a reviewer can diff them.

### `PATCH` sends only what changed

On save in edit mode, the form values are diffed against the source as loaded
and only differing keys are sent. Arrays compare by value, not reference.

This is what `PATCH` means, and it matters concretely: the API's ingestion
service writes `lastRunAt` and `lastError` on the same row, and a scheduled run
can land between opening the modal and saving it. Sending all nineteen fields
would be a last-write-wins overwrite of everything, including fields the user
never looked at. A diff limits the blast radius to what they actually touched.

If the diff is empty the modal closes without a request — the API rejects a
`PATCH` with no keys, and sending one to get a guaranteed 400 is pointless.

### Errors on screen

`App.useApp()`'s `message` for transient failures, with two special cases:

- **409 on save** becomes an inline field error on `name`
  (`Form.setFields`), because that is the field at fault and a toast would leave
  the user re-reading the form to find it. The modal stays open.
- **The initial list failing** renders an antd `Alert` with the message and a
  retry button, in place of the table. A toast for a page that has no content
  behind it would leave an empty screen with no explanation once it faded.

`400` from a write is shown with the server's message, which is
`zodMessage`-flattened and already names the offending path.

One refinement on "toast": failures raised **while the modal is open** render
inline at the top of the form rather than as a toast. The modal owns the
screen at that moment, and a message that appears outside it — and then fades
— is the one the user is least likely to connect to the button they just
pressed. Toasts are for the row-level actions on the page behind it.

## Files

```
src/
  api/
    client.ts          request<T>(), ApiError, X-User-Id injection
    sources.ts         Source type + the five CRUD calls
  components/
    SourceFormModal.tsx
  pages/
    SourcesPage.tsx    rewritten
  vite-env.d.ts        ImportMetaEnv.VITE_USER_ID
.env.example
```

`src/api/sources.ts` declares the `Source` interface itself. It is the frontend's
own restatement of the wire shape, and if the API changes, this is the file that
changes with it.

## Testing

`frontend/` has no test runner, and this slice does not add one — that decision
is unchanged and its trigger is "logic worth testing". The diff helper is the
first thing in this app that has an argument for one; it is small enough that
adding Vitest for it alone is not yet justified, and it is named here so the
next slice that touches it can reconsider.

Verification is therefore:

- `npm run typecheck`
- `npm run lint`
- `npx @ant-design/cli lint ./src` — required by `frontend/CLAUDE.md`, and antd
  6 has real deprecations to catch
- Manual: against a running API and Postgres, create a source, see it listed,
  toggle it, edit one field and confirm via `curl` that only that column moved,
  trigger the duplicate-name 409, delete it, and unset `VITE_USER_ID` to see the
  400 path

## Out of scope

- **`PostingsPage`.** Still a placeholder after this slice.
- **Triggering ingestion from the UI.** `POST /ingest` exists; a "Run now"
  button on each row is the obvious next slice and is deliberately not smuggled
  into this one.
- **Any auth beyond the env var**, per the decision above.
- **Theme tokens.** `ConfigProvider` keeps the stock theme.
- **Generating types from `/docs`.** Named as the real fix for validation drift,
  not done here.
