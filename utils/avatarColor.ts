// Distinct, fixed avatar colors so teammates are easy to tell apart.
// Colors are assigned by hashing a stable id (prefer auth user id) into the palette.

const PALETTE = [
  { bg: '#dbeafe', fg: '#1d4ed8' }, // blue
  { bg: '#dcfce7', fg: '#15803d' }, // green
  { bg: '#ffedd5', fg: '#c2410c' }, // orange
  { bg: '#f3e8ff', fg: '#7e22ce' }, // purple
  { bg: '#fce7f3', fg: '#be185d' }, // pink
  { bg: '#e0f2fe', fg: '#0369a1' }, // sky
  { bg: '#fef3c7', fg: '#a16207' }, // amber
  { bg: '#ccfbf1', fg: '#0f766e' }, // teal
  { bg: '#fee2e2', fg: '#b91c1c' }, // red
  { bg: '#e0e7ff', fg: '#4338ca' }, // indigo
  { bg: '#ecfccb', fg: '#4d7c0f' }, // lime
  { bg: '#fae8ff', fg: '#a21caf' }, // fuchsia
] as const

function hashKey(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(31, h) + key.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

/** Background + text colors for an avatar. Prefer a stable user id over display name. */
export function avatarColors(key: string | null | undefined): { background: string; color: string } {
  const k = (key || '?').trim() || '?'
  const swatch = PALETTE[hashKey(k) % PALETTE.length]!
  return { background: swatch.bg, color: swatch.fg }
}

export function avatarInitials(name: string | null | undefined): string {
  const parts = (name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
  if (!parts.length) return '?'
  return parts.map((w) => w[0]!.toUpperCase()).join('')
}
