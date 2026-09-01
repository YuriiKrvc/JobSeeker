import { z } from 'zod'
import type { UsersRepository } from '../repositories/users.repository.js'

/**
 * Stands in for authentication, which does not exist yet. The caller asserts
 * who they are in an `X-User-Id` header and is believed.
 *
 * THIS MUST NOT REACH A DEPLOYMENT — any caller can claim to be any user.
 * When sessions arrive, this function's body is the only thing that changes;
 * routes keep calling it and keep reading the same result shape.
 */
export const USER_ID_HEADER = 'x-user-id'

export type CurrentUser =
  | { ok: true; userId: string }
  | { ok: false; status: 400 | 404; message: string }

const uuid = z.uuid()

export async function resolveCurrentUser(
  headerValue: string | string[] | undefined,
  users: UsersRepository,
): Promise<CurrentUser> {
  if (headerValue === undefined) {
    return {
      ok: false,
      status: 400,
      message: `Missing ${USER_ID_HEADER} header`,
    }
  }
  // A repeated header is ambiguous; guessing which one is meant would be worse
  // than refusing.
  if (Array.isArray(headerValue)) {
    return {
      ok: false,
      status: 400,
      message: `Repeated ${USER_ID_HEADER} header`,
    }
  }
  if (!uuid.safeParse(headerValue).success) {
    return {
      ok: false,
      status: 400,
      message: `${USER_ID_HEADER} must be a uuid`,
    }
  }
  // Checked rather than trusted: without this a typo'd id would quietly return
  // an empty list instead of failing.
  if (!(await users.exists(headerValue))) {
    return { ok: false, status: 404, message: 'No such user' }
  }
  return { ok: true, userId: headerValue }
}
