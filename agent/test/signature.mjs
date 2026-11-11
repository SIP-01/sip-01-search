import assert from 'node:assert/strict';
import test from 'node:test';
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';

test('accepts a valid NIP-01 event and rejects tampered event content', () => {
  // Fixed test-only secret scalar; never use this key outside this test.
  const testOnlySecret = new Uint8Array(32).fill(7);
  const signed = finalizeEvent({
    kind: 1,
    created_at: 1700000000,
    tags: [],
    content: 'public signature verification regression test',
  }, testOnlySecret);

  assert.equal(verifyEvent(signed), true);

  // Construct a new plain event object so the nostr-tools verified-result cache
  // on the original object cannot hide the mutation.
  const tampered = {
    id: signed.id,
    pubkey: signed.pubkey,
    created_at: signed.created_at,
    kind: signed.kind,
    tags: signed.tags,
    content: signed.content + ' altered',
    sig: signed.sig,
  };
  assert.equal(verifyEvent(tampered), false);
});

test('rejects a malformed signature', () => {
  const testOnlySecret = new Uint8Array(32).fill(9);
  const signed = finalizeEvent({
    kind: 1,
    created_at: 1700000001,
    tags: [],
    content: 'malformed signature regression test',
  }, testOnlySecret);
  const malformed = {
    id: signed.id,
    pubkey: signed.pubkey,
    created_at: signed.created_at,
    kind: signed.kind,
    tags: signed.tags,
    content: signed.content,
    sig: 'not-a-signature',
  };
  assert.equal(verifyEvent(malformed), false);
});
