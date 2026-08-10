// Distinct, fixed colors for topic tag chips — hashed by concept id.
// Deliberately a separate palette (and hash salt) from avatarColor.ts, and a
// lighter/outlined treatment rather than a filled circle, so a tag never
// reads as "belonging to" a teammate whose avatar happens to share a hue.

const PALETTE = [
  { bg: '#f0fdfa', fg: '#0d9488', border: '#99f6e4' }, // teal
  { bg: '#fdf4ff', fg: '#a21caf', border: '#f5d0fe' }, // fuchsia
  { bg: '#f0fdf4', fg: '#16a34a', border: '#bbf7d0' }, // green
  { bg: '#fff7ed', fg: '#c2410c', border: '#fed7aa' }, // orange
  { bg: '#eff6ff', fg: '#2563eb', border: '#bfdbfe' }, // blue
  { bg: '#fdf2f8', fg: '#db2777', border: '#fbcfe8' }, // pink
  { bg: '#f7fee7', fg: '#4d7c0f', border: '#d9f99d' }, // lime
  { bg: '#f5f3ff', fg: '#6d28d9', border: '#ddd6fe' }, // violet
  { bg: '#fefce8', fg: '#a16207', border: '#fef08a' }, // yellow
  { bg: '#f8fafc', fg: '#475569', border: '#e2e8f0' }, // slate
] as const

function hashKey(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(31, h) + key.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

/** Background + text + border colors for a topic tag chip. Keyed off the concept id. */
export function tagColors(key: string | null | undefined): { background: string; color: string; borderColor: string } {
  const k = `tag:${(key || '?').trim() || '?'}`
  const swatch = PALETTE[hashKey(k) % PALETTE.length]!
  return { background: swatch.bg, color: swatch.fg, borderColor: swatch.border }
}
