import assert from 'node:assert/strict';
import { setup } from './harness.mjs';
const { mf, api, engineRequests } = await setup({ engine: true });
try {
  const voices = await (await api('/api/voicevox/voices', { user: null })).json();
  assert.equal(voices.ready, true);
  const v = voices.voices[0];
  assert.equal(
    (
      await api('/api/voicevox/generate', {
        method: 'POST',
        user: null,
        data: { text: 'あさ', uuid: v.uuid },
      })
    ).status,
    401,
  );
  const denied = await api('/api/voicevox/generate', {
    method: 'POST',
    data: { text: 'あさ', uuid: '0ebe2c7d-96f3-4f0e-a2e3-ae13fe27c403' },
  });
  assert.equal(denied.status, 400);
  assert.equal(engineRequests.length, 0);
  const made = await api('/api/voicevox/generate', {
    method: 'POST',
    data: { text: 'あさ', uuid: v.uuid, credit: 'forged' },
  });
  assert.equal(made.status, 201);
  const b = await made.json();
  assert.equal(b.credit, v.credit);
  assert.equal((await api(b.url, { user: null })).status, 200);
  assert.ok(engineRequests.every((x) => x.auth === 'Bearer test-fixture-key'));
  const redirect = await api('/api/voicevox/generate', {
    method: 'POST',
    data: { text: 'redirect', uuid: v.uuid },
  });
  assert.equal(redirect.status, 502);
  console.log(
    'PASS VOICEVOX stub integration: auth, allowlist, engine flow, canonical credit, R2, redirect rejection (no real engine synthesis)',
  );
} finally {
  await mf.dispose();
}
