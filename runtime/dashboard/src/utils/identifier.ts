import type { FixtureObject } from '../model/object'

/**
 * Safely extracts the primary identifier string value from a FixtureObject,
 * avoiding `[object Object]` rendering bugs when identifier entries are objects
 * like `{ value: string, stability: string }`.
 */
export function getPrimaryIdentifierValue(obj: FixtureObject | null | undefined): string {
  if (!obj) return '—'

  const primaryField = obj.canonical.identifiers?.primary?.[0] ?? 'id'
  const entry = obj.canonical.identifiers?.[primaryField]

  if (entry && typeof entry === 'object' && 'value' in entry) {
    return String((entry as { value: unknown }).value)
  }

  if (entry !== undefined && entry !== null) {
    return String(entry)
  }

  return obj.fixture_key
}
