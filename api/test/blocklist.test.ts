import { describe, expect, it } from 'vitest'
import { findBlockedWord } from '../src/services/blocklist.js'

describe('findBlockedWord', () => {
  it('matches a whole word regardless of case', () => {
    expect(findBlockedWord('Senior PHP Developer', ['php'])).toBe('php')
  })

  it('does not match inside a longer word', () => {
    expect(findBlockedWord('phpMyAdmin specialist', ['php'])).toBeNull()
  })

  it('matches a word followed by punctuation', () => {
    expect(findBlockedWord('We need PHP, urgently', ['php'])).toBe('php')
    expect(findBlockedWord('Must know PHP.', ['php'])).toBe('php')
  })

  it('keeps + and # so c++ and c# are matchable', () => {
    expect(findBlockedWord('C++ Engineer', ['c++'])).toBe('c++')
    expect(findBlockedWord('C# Engineer', ['c#'])).toBe('c#')
    expect(findBlockedWord('C++ Engineer', ['c'])).toBeNull()
  })

  it('returns the first matching word in list order', () => {
    expect(findBlockedWord('PHP and Drupal', ['drupal', 'php'])).toBe('drupal')
  })

  it('returns null for an empty word list', () => {
    expect(findBlockedWord('anything at all', [])).toBeNull()
  })

  it('ignores an empty or whitespace entry rather than matching everything', () => {
    expect(findBlockedWord('anything at all', ['', '   '])).toBeNull()
  })

  it('matches across newlines, as a description arrives', () => {
    expect(findBlockedWord('Stack:\n  - PHP\n  - MySQL', ['mysql'])).toBe(
      'mysql',
    )
  })

  it('returns the entry as it was written, not the normalized form', () => {
    expect(findBlockedWord('Senior PHP Developer', ['PHP'])).toBe('PHP')
    expect(findBlockedWord('Senior PHP Developer', ['  Php  '])).toBe('  Php  ')
  })
})
