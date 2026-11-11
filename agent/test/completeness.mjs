import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyEoseHints, nextPaginationCursor } from '../completeness.mjs';

test('NIP-67 known hints take precedence and unknown hints are ignored', () => {
  assert.equal(classifyEoseHints(['finish', 'future-hint']), 'complete');
  assert.equal(classifyEoseHints(['more', 'future-hint']), 'more-available');
  assert.equal(classifyEoseHints(['auth', 'finish']), 'auth-required');
  assert.equal(classifyEoseHints(['future-hint']), 'legacy');
  assert.equal(classifyEoseHints([]), 'legacy');
});

test('pagination cursor uses the oldest valid event timestamp', () => {
  const events = [{ id: 'a', created_at: 100 }, { id: 'b', created_at: 120 }];
  assert.deepEqual(nextPaginationCursor(events, [events[0]], undefined), { ok: true, until: 100 });
});

test('pagination refuses empty pages and cursors that do not move backward', () => {
  const event = { id: 'a', created_at: 100 };
  assert.equal(nextPaginationCursor([event], [], undefined).ok, false);
  assert.equal(nextPaginationCursor([event], [event], 100).ok, false);
  assert.equal(nextPaginationCursor([{ id: 'bad', created_at: '100' }], [{ id: 'bad' }], undefined).ok, false);
});
