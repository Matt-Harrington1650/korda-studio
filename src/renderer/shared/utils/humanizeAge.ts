/**
 * Converts a duration in milliseconds into a human-readable relative string.
 * @param ageMs - duration in ms (i.e. Date.now() - someEpochMs). NOT an epoch.
 */
export function humanizeAge(ageMs: number): string {
  if (ageMs < 60_000) return 'just now'
  const minutes = Math.floor(ageMs / 60_000)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  return `${hours} hr ago`
}
