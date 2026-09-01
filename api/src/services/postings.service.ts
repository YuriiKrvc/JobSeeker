// src/services/postings.service.ts — Task 9 replaces the body of `search`.
import type { PostingsRepository } from '../repositories/postings.repository.js'

export function createPostingsService(repo: PostingsRepository) {
  return { repo }
}

export type PostingsService = ReturnType<typeof createPostingsService>
