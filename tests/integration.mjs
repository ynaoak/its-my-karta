import assert from 'node:assert/strict';
import { setup } from './harness.mjs';
const { mf, db, api } = await setup();
let checks = 0;
function ok() {
  checks++;
}
async function json(path, opts) {
  const r = await api(path, opts);
  const b = await r.json();
  assert.ok(r.ok, JSON.stringify(b));
  return b;
}
function monitor(ws) {
  const events = [];
  ws.accept();
  ws.addEventListener('message', (e) => {
    events.push(JSON.parse(e.data));
  });
  return {
    ws,
    events,
    async wait(fn) {
      const until = Date.now() + 7000;
      while (Date.now() < until) {
        const b = events.find(fn);
        if (b) return b;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error('Missing state: ' + JSON.stringify(events.slice(-3)));
    },
  };
}
try {
  assert.equal((await api('/api/decks', { user: null })).status, 401);
  ok();
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
    'base64',
  );
  const image = (await json('/api/upload/image', { method: 'POST', raw: png })).url;
  const media = await api(image, { user: null });
  assert.deepEqual(Buffer.from(await media.arrayBuffer()), png);
  assert.equal((await api('/api/upload/image', { method: 'POST', raw: '<svg/>' })).status, 415);
  ok();
  const wav = Buffer.alloc(100);
  wav.write('RIFF');
  wav.writeUInt32LE(92, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(22050, 24);
  wav.writeUInt32LE(44100, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(56, 40);
  const audio = (await json('/api/upload/audio', { method: 'POST', raw: wav })).url;
  const range = await api(audio, { headers: { Range: 'bytes=0-19' }, user: null });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 20);
  ok();
  const cards = [
    { kana: 'あ', text: 'あさのひかり', image, audio, credit: '録音テスト' },
    { kana: 'い', text: 'いちご', image },
  ];
  const d = await json('/api/decks', { method: 'POST', data: { title: 'テストかるた', cards } });
  assert.equal(d.revision, 1);
  assert.equal((await api('/api/decks/' + d.id, { user: 'user_other' })).status, 404);
  assert.equal((await json('/api/decks', { user: 'user_other' })).decks.length, 0);
  ok();
  const updates = await Promise.all([
    api('/api/decks/' + d.id, { method: 'PUT', data: { title: '更新A', cards, revision: 1 } }),
    api('/api/decks/' + d.id, { method: 'PUT', data: { title: '更新B', cards, revision: 1 } }),
  ]);
  assert.deepEqual(updates.map((r) => r.status).sort(), [200, 409]);
  ok();
  assert.equal((await api('/api/decks/' + d.id, { method: 'DELETE' })).status, 428);
  assert.equal(
    (await api('/api/decks/' + d.id, { method: 'DELETE', headers: { 'If-Match': '1' } })).status,
    409,
  );
  ok();
  for (let i = 0; i < 21; i++)
    await json('/api/decks', { method: 'POST', data: { title: '空の下書き' + i, cards: [] } });
  const page = await json('/api/decks');
  assert.equal(page.decks.length, 20);
  const page2 = await json('/api/decks?cursor=' + encodeURIComponent(page.nextCursor));
  assert.equal(page2.decks.length, 2);
  assert.equal(new Set([...page.decks, ...page2.decks].map((x) => x.id)).size, 22);
  ok();
  assert.equal((await api('/api/rooms', { method: 'POST', user: null, data: {} })).status, 401);
  assert.equal(
    (
      await api('/api/rooms', {
        method: 'POST',
        headers: { Origin: 'https://evil.test' },
        data: {},
      })
    ).status,
    403,
  );
  ok();
  const ns = await mf.getDurableObjectNamespace('ROOMS');
  async function inspect(id) {
    return (await ns.get(ns.idFromString(id)).fetch('https://room/__inspect')).json();
  }
  async function room(mode = 'all', target = 1) {
    return json('/api/rooms', {
      method: 'POST',
      data: { cards, rules: { mode, memorizeSeconds: 0, durationSeconds: 10, target }, ttl: 60 },
    });
  }
  async function join(id, user, name) {
    const t = await json(`/api/rooms/${id}/join`, { method: 'POST', user, data: { name } });
    const r = await api(`/api/rooms/${id}/ws?ticket=${t.ticket}`, {
      user: null,
      headers: { Upgrade: 'websocket' },
    });
    assert.equal(r.status, 101);
    const m = monitor(r.webSocket);
    await m.wait((e) => e.type === 'state');
    return m;
  }
  async function gone(id) {
    assert.deepEqual(await inspect(id), { entries: [], alarm: null });
    assert.equal(
      (await api(`/api/rooms/${id}/join`, { method: 'POST', user: null, data: { name: '後から' } }))
        .status,
      410,
    );
    assert.ok((await json('/api/decks/' + d.id)).cards.length);
    ok();
  }
  const r = await room();
  const host = await join(r.id, 'user_host', '主催者'),
    guest = await join(r.id, null, 'ゲスト');
  guest.ws.send(JSON.stringify({ type: 'start' }));
  await guest.wait((e) => e.type === 'error');
  host.ws.send(JSON.stringify({ type: 'start' }));
  let state = await host.wait((e) => e.phase === 'play' && e.prompt);
  assert.equal(state.prompt.id, undefined);
  const current = cards.find((c) => c.text === state.prompt.text).kana;
  for (const m of [host, guest])
    m.ws.send(JSON.stringify({ type: 'tap', card: current, round: state.round }));
  const one = await host.wait((e) => e.type === 'state' && e.taken?.length === 1);
  assert.equal(
    one.players.reduce((s, p) => s + p.score, 0),
    1,
  );
  ok();
  state = await host.wait((e) => e.phase === 'play' && e.round === 2 && e.prompt);
  host.ws.send(
    JSON.stringify({
      type: 'tap',
      card: cards.find((c) => c.text === state.prompt.text).kana,
      round: state.round,
    }),
  );
  const final = await host.wait((e) => e.phase === 'ended');
  assert.equal(
    final.players.reduce((s, p) => s + p.score, 0),
    2,
  );
  await gone(r.id);
  const t = await room('target');
  const h = await join(t.id, 'user_host', '先取');
  h.ws.send(JSON.stringify({ type: 'start' }));
  state = await h.wait((e) => e.phase === 'play');
  h.ws.send(
    JSON.stringify({
      type: 'tap',
      card: cards.find((c) => c.text === state.prompt.text).kana,
      round: state.round,
    }),
  );
  await h.wait((e) => e.phase === 'ended' && e.reason === 'target');
  await gone(t.id);
  const timed = await room('time'),
    ht = await join(timed.id, 'user_host', '時間');
  ht.ws.send(JSON.stringify({ type: 'start' }));
  await ht.wait((e) => e.phase === 'play');
  await ns.get(ns.idFromString(timed.id)).fetch('https://room/__time');
  await ht.wait((e) => e.phase === 'ended' && e.reason === 'time');
  await gone(timed.id);
  const exp = await room();
  await ns.get(ns.idFromString(exp.id)).fetch('https://room/__expiry');
  await new Promise((r) => setTimeout(r, 250));
  await gone(exp.id);
  const end = await room(),
    he = await join(end.id, 'user_host', '終了');
  he.ws.send(JSON.stringify({ type: 'end' }));
  await he.wait((e) => e.phase === 'ended' && e.reason === 'host');
  await gone(end.id);
  assert.equal((await json('/api/voicevox/voices', { user: null })).voices.length, 37);
  assert.equal(
    (
      await api('/api/voicevox/generate', {
        method: 'POST',
        data: { text: 'あ', uuid: '0ebe2c7d-96f3-4f0e-a2e3-ae13fe27c403' },
      })
    ).status,
    503,
  );
  assert.equal((await json('/api/tts/config', { user: null })).ready, false);
  ok();
  console.log(
    `PASS ${checks} integration groups: real D1, R2, Clerk JWT verification, concurrent capture, all/time/target/host/expiry deletion`,
  );
} finally {
  await mf.dispose();
}
