// The client's only link to the API (blueprint 12.7). Every call goes through `request`, which
// reads the answer's status and nothing else of a failure: the class of an outcome is decided
// here, once, and the page decides what each class shows.

const BASE = import.meta.env.VITE_API_BASE_URL || '/api';

/** The back-end carried the request out (status 200, and only 200). */
export const CONFIRMED = 'confirmed';
/** The acting identity may not make the request (403): the Access denied modal. */
export const REFUSED = 'refused';
/** The request's content was not accepted (422). Only an Add reads this apart from a failure. */
export const INVALID = 'invalid';
/** Any other answer, or a request that never reached the server: the API failure modal. */
export const FAILED = 'failed';

/**
 * Make one call as `actor` and settle it to `{ outcome, data }`. `data` is the parsed body of a
 * confirmed answer and is undefined otherwise. Never rejects.
 */
export async function request(actor, method, route, body) {
  const headers = { 'X-User-Id': String(actor.id) };
  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    // Looked up at the moment of the call, so that a test can replace it.
    response = await globalThis.fetch(`${BASE}${route}`, init);
  } catch {
    return { outcome: FAILED };
  }

  if (response.status === 200) {
    try {
      return { outcome: CONFIRMED, data: await response.json() };
    } catch {
      // A success whose body is not the resource cannot update the list.
      return { outcome: FAILED };
    }
  }
  if (response.status === 403) return { outcome: REFUSED };
  if (response.status === 422) return { outcome: INVALID };
  return { outcome: FAILED };
}
