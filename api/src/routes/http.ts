import { z } from 'zod'
import { USER_ID_HEADER, resolveCurrentUser } from '../auth/current-user.js'
import { ErrorSchema } from '../openapi.js'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { UsersRepository } from '../repositories/users.repository.js'

/** Shared `:id` route param, used by every route keyed on a single resource. */
export const IdParams = z.object({ id: z.uuid() })

/** The pair of error statuses every route in this API can answer with. */
export const errorResponses = {
  400: ErrorSchema,
  404: ErrorSchema,
}

/**
 * There is no `setErrorHandler` (see CLAUDE.md, Errors), so a route that
 * answers for itself must reproduce Fastify's default body by hand. Two
 * validators run against every body — Ajv from the published JSON Schema, then
 * Zod for the rules JSON Schema cannot express — and if their 400s had
 * different shapes the documented one would be true only half the time.
 *
 * Extracted here because three route files now need the same five helpers.
 */
export function fail(
  reply: FastifyReply,
  statusCode: number,
  error: string,
  message: string,
) {
  return reply.code(statusCode).send({ statusCode, error, message })
}

export function badRequest(reply: FastifyReply, message: string) {
  return fail(reply, 400, 'Bad Request', message)
}

export function notFound(reply: FastifyReply, message = 'No such source') {
  return fail(reply, 404, 'Not Found', message)
}

export function conflict(reply: FastifyReply, message: string) {
  return fail(reply, 409, 'Conflict', message)
}

/** Flattens a ZodError into one line, so the message field stays a string. */
export function zodMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(body)'}: ${issue.message}`)
    .join('; ')
}

/**
 * Resolves the caller or answers the request. The returned function yields null
 * when it has already replied, so every handler starts with the same two lines.
 */
export function makeCaller(users: UsersRepository) {
  return async function caller(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<string | null> {
    const result = await resolveCurrentUser(
      request.headers[USER_ID_HEADER],
      users,
    )
    if (result.ok) return result.userId
    if (result.status === 400) {
      await badRequest(reply, result.message)
    } else {
      await notFound(reply, result.message)
    }
    return null
  }
}
