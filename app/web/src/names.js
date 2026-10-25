// The name check made before an Add is sent (blueprint 12.7, DD-06, DD-21). It must agree with
// the server's `str.strip()` and its count of code points, so that a name the server would
// accept is never refused here.

export const NAME_MAX_LENGTH = 100;
export const NAME_REQUIRED = 'Name is required.';
export const NAME_TOO_LONG = 'Name must be 100 characters or fewer.';

// The characters for which Python's `str.isspace()` is true. JavaScript's `trim()` is not used:
// it also strips U+FEFF and keeps U+001C to U+001F and U+0085. The class is written as a string
// of escapes, not a regular-expression literal: the build prints U+2028 and U+2029 inside a
// literal as raw line separators, which end it.
const SPACE = '[\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const EDGE_SPACE = new RegExp(`^${SPACE}+|${SPACE}+$`, 'g');

export const trimName = (raw) => raw.replace(EDGE_SPACE, '');

/** The length in Unicode code points, never in UTF-16 units. */
export const nameLength = (name) => Array.from(name).length;

/** The inline message an over-long or empty name shows, or null for a name that may be sent. */
export function nameProblem(name) {
  if (name === '') return NAME_REQUIRED;
  if (nameLength(name) > NAME_MAX_LENGTH) return NAME_TOO_LONG;
  return null;
}
