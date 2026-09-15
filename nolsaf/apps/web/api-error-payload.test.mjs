import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeApiErrorPayload } from './lib/apiErrorPayload.ts';

test('decodes a finance verification JSON Blob', async () => {
  assert.deepEqual(await decodeApiErrorPayload(new Blob(['{"error":"OTP required","require2fa":true}'], { type: 'application/json' })), { error: 'OTP required', require2fa: true });
});

test('preserves existing JSON errors and non-JSON downloads', async () => {
  const error = { error: 'Forbidden' };
  assert.equal(await decodeApiErrorPayload(error), error);
  const csv = new Blob(['invoice,amount\nINV-1,500']);
  assert.equal(await decodeApiErrorPayload(csv), csv);
});

test('does not decode oversized or non-object payloads', async () => {
  const large = new Blob([' '.repeat(65537)]);
  assert.equal(await decodeApiErrorPayload(large), large);
  const array = new Blob(['[]']);
  assert.equal(await decodeApiErrorPayload(array), array);
});
