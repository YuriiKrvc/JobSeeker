/**
 * The one place this project performs an outbound HTTP request.
 *
 * Injected into the ingestion service rather than imported by it, so the unit
 * suite can pass canned HTML and never open a socket. Node 22's global `fetch`
 * is enough — no HTTP client dependency.
 */
export type FetchText = (url: string, timeoutMs: number) => Promise<string>

/** Sent so a board's operator can see who is scraping them and complain. */
const USER_AGENT = 'JobSeeker/0.1 (+https://github.com/jobseeker)'

export const fetchText: FetchText = async (url, timeoutMs) => {
  let response: Response
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': USER_AGENT },
      redirect: 'follow',
    })
  } catch (error) {
    // An abort surfaces as a bare "This operation was aborted", which in a
    // stored `last_error` gives no clue that a timeout is what happened.
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(`${url}: timed out after ${timeoutMs}ms`)
    }
    throw new Error(
      `${url}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`)
  }
  return response.text()
}
