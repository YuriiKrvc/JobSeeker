import { describe, expect, it } from 'vitest'
import { resolveCurrentUser } from '../src/auth/current-user.js'
import type { UsersRepository } from '../src/repositories/users.repository.js'

const KNOWN = '00000000-0000-4000-8000-000000000001'
const UNKNOWN = '11111111-1111-4111-8111-111111111111'

const users: UsersRepository = {
  exists: (id) => Promise.resolve(id === KNOWN),
}

describe('resolveCurrentUser', () => {
  it('resolves a known user', async () => {
    expect(await resolveCurrentUser(KNOWN, users)).toEqual({ ok: true, userId: KNOWN })
  })

  it('400s when the header is absent', async () => {
    expect(await resolveCurrentUser(undefined, users)).toMatchObject({ ok: false, status: 400 })
  })

  it('400s when the header is not a uuid', async () => {
    expect(await resolveCurrentUser('not-a-uuid', users)).toMatchObject({ ok: false, status: 400 })
  })

  it('400s on a repeated header rather than picking one', async () => {
    expect(await resolveCurrentUser([KNOWN, UNKNOWN], users)).toMatchObject({ ok: false, status: 400 })
  })

  it('404s on a well-formed uuid naming no user', async () => {
    expect(await resolveCurrentUser(UNKNOWN, users)).toMatchObject({ ok: false, status: 404 })
  })

  it('does not look up a malformed id', async () => {
    let called = false
    const spy: UsersRepository = {
      exists: () => {
        called = true
        return Promise.resolve(true)
      },
    }
    await resolveCurrentUser('nope', spy)
    expect(called).toBe(false)
  })
})
