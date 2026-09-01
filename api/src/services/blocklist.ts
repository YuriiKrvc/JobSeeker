/**
 * Whole-word, case-insensitive blocklist matching. `php` blocks "PHP
 * Developer" and not "phpMyAdmin".
 *
 * Tokenizing beats a `\b`-anchored regex here: `\bc\+\+\b` cannot match "C++"
 * at all, because `+` is not a word character and the trailing boundary never
 * appears. Splitting on everything except letters, digits, `+` and `#` makes
 * "c++" and "c#" matchable and keeps trailing punctuation ("PHP.") from
 * defeating a match.
 *
 * The consequence, and it is worth knowing before you write a blocklist: a dot
 * is a separator, so "node.js" tokenizes to `node` and `js`. Block `node`, not
 * `node.js`. Entries are single tokens — phrase matching is not supported.
 *
 * Words arrive already lowercased and trimmed (the sources service normalizes
 * them on write); the guards here exist because a hand-written row need not.
 */
const SEPARATORS = /[^\p{L}\p{N}+#]+/u

export function findBlockedWord(text: string, words: string[]): string | null {
  if (words.length === 0) return null
  const tokens = new Set(
    text.toLowerCase().split(SEPARATORS).filter((token) => token.length > 0),
  )
  for (const word of words) {
    const needle = word.trim().toLowerCase()
    // An empty entry would otherwise match every text, blocking a whole board.
    if (needle.length === 0) continue
    if (tokens.has(needle)) return word
  }
  return null
}
