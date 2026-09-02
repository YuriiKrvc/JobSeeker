/**
 * The only file in this app that calls `fetch`.
 *
 * `/api` is a dev-server fiction: vite.config.ts proxies it to the Fastify
 * API and strips the prefix, so `/api/sources` arrives as `/sources`. A
 * deployment has to reproduce that rewrite — see frontend/CLAUDE.md.
 */
const BASE = '/api'

export class ApiError extends Error {
  readonly status: number
  /** The envelope's `error` field, e.g. 'Bad Request', 'Conflict'. */
  readonly error: string

  constructor(status: number, error: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.error = error
  }
}

/** Every API failure arrives in this shape — see api/src/routes/http.ts. */
interface ErrorBody {
  statusCode: number
  error: string
  message: string
}

function isErrorBody(value: unknown): value is ErrorBody {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Record<string, unknown>
  return typeof body.error === 'string' && typeof body.message === 'string'
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  const userId = import.meta.env.VITE_USER_ID
  // Omitted rather than sent blank when unset: the API's 400 for a missing
  // header names the problem, the one for a malformed value does not.
  if (userId) headers.set('X-User-Id', userId)
  if (init.body !== undefined) headers.set('Content-Type', 'application/json')

  const response = await fetch(`${BASE}${path}`, { ...init, headers })

  if (!response.ok) throw await toApiError(response)
  // DELETE answers 204, which has no body to parse.
  if (response.status === 204) return undefined as unknown as T
  return (await response.json()) as T
}

/**
 * A failing response is not guaranteed to carry the error envelope. A dead
 * proxy, or a dev server with no API behind it, answers with HTML — and
 * `response.json()` would then throw a SyntaxError whose message ("Unexpected
 * token <") tells the user nothing about what went wrong.
 */
async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  if (isErrorBody(body)) {
    return new ApiError(response.status, body.error, body.message)
  }
  return new ApiError(
    response.status,
    response.statusText || 'Error',
    `Request failed with status ${response.status}`,
  )
}
