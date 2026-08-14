import { createHash, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'

/**
 * Synthetic auth email for a study userID (Supabase Auth still needs email).
 * Keyed on userID + sessionID, not userID alone — auth.users.email is
 * globally unique, and the same userID (e.g. "Alice") must be usable in
 * multiple sessions as fully separate participants.
 */
export function studyEmail(userId: string, sessionId: string): string {
  return `${userId.toLowerCase()}+${sessionId.toLowerCase()}@study.convfork.local`
}

const USER_ID_RE = /^[a-zA-Z0-9._-]{2,64}$/
const SESSION_ID_RE = /^[a-zA-Z0-9._-]{6,64}$/

export function validateStudyUserId(userId: string): string {
  const v = userId.trim()
  if (!USER_ID_RE.test(v)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'userID must be 2–64 chars (letters, digits, . _ -)',
    })
  }
  return v
}

export function validateSessionId(sessionId: string): string {
  const v = sessionId.trim()
  if (!SESSION_ID_RE.test(v)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'sessionID must be 6–64 chars (letters, digits, . _ -)',
    })
  }
  return v
}

export type SharingCondition = 'selective_sharing' | 'individual_llm'

export function validateSharingCondition(raw: unknown): SharingCondition {
  const v = typeof raw === 'string' ? raw.trim() : ''
  if (v === 'selective_sharing' || v === 'individual_llm') return v
  throw createError({
    statusCode: 400,
    statusMessage: 'condition must be "selective_sharing" or "individual_llm"',
  })
}

export function conditionLabel(c: SharingCondition | string | null | undefined): string {
  if (c === 'selective_sharing') return 'Selective sharing'
  if (c === 'individual_llm') return 'Individual LLM'
  return '—'
}

const ADMIN_COOKIE = 'cf_admin'

function expectedAdminToken(password: string): string {
  return createHash('sha256').update(`convfork-admin:${password}`).digest('hex')
}

export function setAdminCookie(event: H3Event, password: string) {
  setCookie(event, ADMIN_COOKIE, expectedAdminToken(password), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12, // 12h
  })
}

export function clearAdminCookie(event: H3Event) {
  deleteCookie(event, ADMIN_COOKIE, { path: '/' })
}

export function isAdminAuthenticated(event: H3Event): boolean {
  const config = useRuntimeConfig()
  const password = (config.adminPassword as string) || ''
  if (!password) return false
  const cookie = getCookie(event, ADMIN_COOKIE)
  if (!cookie) return false
  const expected = expectedAdminToken(password)
  try {
    const a = Buffer.from(cookie)
    const b = Buffer.from(expected)
    return a.length === b.length && timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/** Gate study-admin APIs/pages behind the admin cookie. */
export function requireAdmin(event: H3Event) {
  if (!isAdminAuthenticated(event)) {
    throw createError({ statusCode: 401, statusMessage: 'Admin login required' })
  }
}
