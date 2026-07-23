import { marked } from 'marked'
import DOMPurify from 'dompurify'

// GitHub-flavored markdown, single newlines become <br> (chat-style).
marked.setOptions({ gfm: true, breaks: true })

// Render assistant markdown to sanitized HTML. Assistant replies are shared
// across team members, so a prompt-injected reply could otherwise smuggle
// active HTML into a teammate's browser — DOMPurify strips it. Runs client-only
// (DOMPurify needs a DOM); on the server we return '' and let <ClientOnly>
// hydrate the formatted body, so there's no hydration mismatch.
export function renderMarkdown(src: string): string {
  if (!import.meta.client || !src) return ''
  const html = marked.parse(src, { async: false }) as string
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}
