import { randomUUID } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { generateKeyPair, exportSPKI, SignJWT } from 'jose';
import { readFile } from 'node:fs/promises';
export async function setup({ engine = false } = {}) {
  const scriptPath = `.cache/test-worker-${randomUUID()}.mjs`;
  const engineRequests = [];
  const audit = JSON.parse(await readFile('docs/voicevox-audit.json', 'utf8'));
  const fixtureWav = Buffer.alloc(100);
  fixtureWav.write('RIFF');
  fixtureWav.write('WAVE', 8);
  await build({
    entryPoints: ['tests/fixture-worker.js'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    external: ['cloudflare:workers'],
    outfile: scriptPath,
  });
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const publicPem = await exportSPKI(publicKey);
  const domain = 'clerk.karta.test';
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      name: 'karuta-test',
      modules: true,
      scriptPath,
      compatibilityDate: '2026-11-01',
      r2Buckets: ['MEDIA'],
      d1Databases: ['DB'],
      durableObjects: { ROOMS: { className: 'KarutaRoom', useSQLite: true } },
      bindings: {
        CLERK_PUBLISHABLE_KEY: 'pk_test_' + Buffer.from(domain + '$').toString('base64'),
        CLERK_JWT_KEY: publicPem,
        CLERK_AUTHORIZED_PARTIES: 'https://karta.test',
        ...(engine
          ? {
              VOICEVOX_ENGINE_URL: 'https://engine.karta.test',
              VOICEVOX_API_KEY: 'test-fixture-key',
            }
          : {}),
      },
      ...(engine
        ? {
            outboundService: async (req) => {
              const url = new URL(req.url);
              engineRequests.push({ path: url.pathname, auth: req.headers.get('Authorization') });
              if (url.pathname === '/speakers')
                return Response.json(
                  audit.characters
                    .filter((x) => x.allowed)
                    .map((x, i) => ({ speaker_uuid: x.uuid, styles: [{ id: i + 1 }] })),
                );
              if (url.pathname === '/audio_query')
                return url.searchParams.get('text') === 'redirect'
                  ? new Response(null, {
                      status: 302,
                      headers: { Location: 'https://elsewhere.test' },
                    })
                  : Response.json({ accent_phrases: [], speedScale: 1 });
              if (url.pathname === '/synthesis')
                return new Response(fixtureWav, { headers: { 'Content-Type': 'audio/wav' } });
              return new Response('no', { status: 404 });
            },
          }
        : {}),
      serviceBindings: {
        ASSETS: async (req) => {
          try {
            const path = new URL(req.url).pathname;
            const file = path === '/' ? 'index.html' : path.slice(1);
            if (file.includes('..')) return new Response('bad', { status: 400 });
            const b = await readFile('public/' + file);
            const ext = file.split('.').pop();
            return new Response(b, {
              headers: {
                'Content-Type':
                  {
                    html: 'text/html',
                    js: 'text/javascript',
                    mjs: 'text/javascript',
                    css: 'text/css',
                    wasm: 'application/wasm',
                    json: 'application/json',
                    xml: 'application/xml',
                    txt: 'text/plain',
                    svg: 'image/svg+xml',
                    png: 'image/png',
                  }[ext] || 'application/octet-stream',
              },
            });
          } catch {
            return new Response('not found', { status: 404 });
          }
        },
      },
    }),
  );
  await mf.ready;
  const db = await mf.getD1Database('DB');
  const sql = await readFile('migrations/0001_decks.sql', 'utf8');
  await db.batch(
    sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => db.prepare(s)),
  );
  const tokens = {};
  for (const id of ['user_host', 'user_other'])
    tokens[id] = await new SignJWT({ sid: 'sess_test', azp: 'https://karta.test', sts: 'active' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://' + domain)
      .setSubject(id)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  const api = async (
    path,
    { method = 'GET', user = 'user_host', data, raw, headers = {} } = {},
  ) => {
    if (user) headers.Authorization = 'Bearer ' + tokens[user];
    if (data !== undefined) headers['Content-Type'] = 'application/json';
    return mf.dispatchFetch('https://karta.test' + path, {
      method,
      headers,
      body: raw ?? (data === undefined ? undefined : JSON.stringify(data)),
    });
  };
  return { mf, db, tokens, api, engineRequests };
}
