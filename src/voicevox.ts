import { user } from './auth';
import { VOICES } from './voicevox-catalog';
import { assert, body, json, readLimited, type Env } from './types';
import { sniff, store } from './media';
async function call(env: Env, path: string, init: RequestInit = {}) {
  const root = new URL(env.VOICEVOX_ENGINE_URL!);
  assert(
    root.protocol === 'https:' && !root.username && !root.password,
    'HTTPSのVOICEVOXエンジンURLが必要です',
    503,
  );
  const headers = new Headers(init.headers);
  if (env.VOICEVOX_API_KEY) headers.set('Authorization', `Bearer ${env.VOICEVOX_API_KEY}`);
  const r = await fetch(new URL(path, root), {
    ...init,
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(45000),
  });
  assert(r.ok, 'VOICEVOXエンジンに接続できません', 502);
  return r;
}
export async function voicevox(req: Request, env: Env) {
  if (new URL(req.url).pathname === '/api/voicevox/voices' && req.method === 'GET')
    return json({ voices: VOICES, ready: !!env.VOICEVOX_ENGINE_URL });
  assert(
    new URL(req.url).pathname === '/api/voicevox/generate' && req.method === 'POST',
    'Not found',
    404,
  );
  await user(req, env);
  assert(env.VOICEVOX_ENGINE_URL, 'VOICEVOXエンジンが未設定です', 503);
  const b = await body(req);
  assert(
    typeof b.text === 'string' && b.text.trim().length >= 1 && b.text.length <= 200,
    '読み札は1〜200文字です',
  );
  const voice = VOICES.find((v) => v.uuid === b.uuid);
  assert(voice, 'この音声は選択できません');
  const speakers = JSON.parse(
    new TextDecoder().decode(await readLimited(await call(env, '/speakers'), 1_000_000)),
  );
  const speaker = speakers.find((s: any) => s.speaker_uuid === voice.uuid),
    style = speaker?.styles?.[0]?.id;
  assert(Number.isInteger(style), 'エンジンにこの音声がありません', 409);
  const query = await readLimited(
    await call(env, `/audio_query?text=${encodeURIComponent(b.text)}&speaker=${style}`, {
      method: 'POST',
    }),
    200_000,
  );
  const audio = await readLimited(
    await call(env, `/synthesis?speaker=${style}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: query,
    }),
    5_000_000,
  );
  assert(sniff(audio, 'audio') === 'audio/wav', '音声形式が不正です', 502);
  return json(
    {
      url: await store(env, audio, 'audio', 'audio/wav'),
      credit: voice.credit,
      terms: voice.terms,
    },
    201,
  );
}
