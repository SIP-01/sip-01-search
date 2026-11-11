/** NIP-67 EOSE classification with the required legacy fallback. */
export function classifyEoseHints(hints = []) {
  const values = Array.isArray(hints) ? hints : [];
  if (values.includes('auth')) return 'auth-required';
  if (values.includes('more')) return 'more-available';
  if (values.includes('finish')) return 'complete';
  // Unknown values are ignored by NIP-67; absent known hints mean fallback.
  return 'legacy';
}

/**
 * Derive a safe until cursor for explicit more or legacy EOSE.
 * A cursor must move strictly backward. freshEvents prevents an endless loop
 * when an inclusive relay cursor returns only events already seen.
 */
export function nextPaginationCursor(events, freshEvents, previousUntil) {
  if (!Array.isArray(freshEvents) || freshEvents.length === 0) {
    return { ok: false, reason: 'no new events' };
  }
  const timestamps = (Array.isArray(events) ? events : [])
    .map(event => event?.created_at)
    .filter(value => Number.isSafeInteger(value) && value >= 0);
  if (timestamps.length === 0) return { ok: false, reason: 'no valid created_at cursor' };
  const oldest = Math.min(...timestamps);
  if (previousUntil !== undefined && previousUntil !== null) {
    const previous = Number(previousUntil);
    if (!Number.isSafeInteger(previous) || oldest >= previous) {
      return { ok: false, reason: 'cursor did not move strictly backward' };
    }
  }
  return { ok: true, until: oldest };
}
