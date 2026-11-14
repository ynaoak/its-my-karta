import { user, sameOrigin, clerkDomain } from './auth';
import { decks } from './decks';
import { body, cards, checkMedia, rules, json, assert, HttpError, type Env } from './types';
import { upload, serve } from './media';
import { voicevox } from './voicevox';
export { KarutaRoom } from './room';
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(req.url),
        p = url.pathname;
      if (!p.startsWith('/api/')) return env.ASSETS.fetch(req);
      if (req.method !== 'GET' && req.method !== 'HEAD') sameOrigin(req);
      if (req.headers.get('upgrade')) sameOrigin(req);
      if (p === '/api/config' && req.method === 'GET')
        return json({
          clerkKey: env.CLERK_PUBLISHABLE_KEY || null,
          clerkDomain: env.CLERK_PUBLISHABLE_KEY ? clerkDomain(env.CLERK_PUBLISHABLE_KEY) : null,
        });
      if (p.startsWith('/api/media/') && (req.method === 'GET' || req.method === 'HEAD'))
        return await serve(req, env, p.slice('/api/media/'.length));
      if (p.startsWith('/api/upload/') && req.method === 'POST') {
        await user(req, env);
        return json({ url: await upload(req, env, p.split('/')[3]) }, 201);
      }
      if (p === '/api/decks' || /^\/api\/decks\/[^/]+$/.test(p))
        return await decks(req, env, (await user(req, env))!, p);
      if (p.startsWith('/api/voicevox/')) return await voicevox(req, env);
      if (p === '/api/tts/config' && req.method === 'GET') {
        const approval = await env.MEDIA.get('tts/approval.json');
        if (!approval)
          return json({
            ready: false,
            message: '日本語モデルの配布条件・商用利用条件を管理者が確認するまで無効です',
          });
        const config = await approval.json<any>();
        assert(
          config.reviewed === true &&
            config.model === 'tsukuyomi' &&
            typeof config.credit === 'string',
          'モデル承認が不正です',
          503,
        );
        const required = [
          'tts/model.onnx',
          'tts/model.onnx.json',
          'tts/runtime/g2p.wasm',
          'tts/runtime/ort-wasm-simd-threaded.wasm',
        ];
        const available = await Promise.all(required.map((x) => env.MEDIA.head(x)));
        assert(available.every(Boolean), 'モデルファイルがありません', 503);
        return json({
          ready: true,
          modelUrl: '/api/tts/assets/model.onnx',
          configUrl: '/api/tts/assets/model.onnx.json',
          credit: config.credit,
        });
      }
      if (p.startsWith('/api/tts/runtime/') && req.method === 'GET') {
        const key = p.slice('/api/tts/runtime/'.length);
        assert(['g2p.wasm', 'ort-wasm-simd-threaded.wasm'].includes(key), 'Not found', 404);
        const obj = await env.MEDIA.get(`tts/runtime/${key}`);
        assert(obj, 'WASMランタイムをR2にインストールしてください', 404);
        return new Response(obj.body, {
          headers: { 'Content-Type': 'application/wasm', 'Cache-Control': 'public,max-age=3600' },
        });
      }
      if (p.startsWith('/api/tts/assets/') && req.method === 'GET') {
        const key = p.slice('/api/tts/assets/'.length);
        assert(['model.onnx', 'model.onnx.json'].includes(key), 'Not found', 404);
        const obj = await env.MEDIA.get(`tts/${key}`);
        assert(obj, 'Not found', 404);
        const h = new Headers({
          'Cache-Control': 'public,max-age=3600',
          'X-Content-Type-Options': 'nosniff',
        });
        obj.writeHttpMetadata(h);
        return new Response(obj.body, { headers: h });
      }
      if (p === '/api/rooms' && req.method === 'POST') {
        const owner = await user(req, env),
          b = await body(req);
        const list = cards(b.cards, 2),
          r = rules(b.rules);
        assert(r.mode !== 'target' || r.target <= list.length, '目標枚数が札の枚数を超えています');
        await checkMedia(env, list);
        const ttl = b.ttl ?? 7200;
        assert(Number.isInteger(ttl) && ttl >= 60 && ttl <= 86400, 'URLの期限は1分〜24時間です');
        const id = env.ROOMS.newUniqueId(),
          room = env.ROOMS.get(id);
        const resp = await room.fetch(
          new Request('https://room/init', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ owner, cards: list, rules: r, ttl }),
          }),
        );
        if (!resp.ok) return resp;
        return json(
          { id: id.toString(), url: `${url.origin}/?room=${id}`, expires: Date.now() + ttl * 1000 },
          201,
        );
      }
      const match = p.match(/^\/api\/rooms\/([a-f0-9]{64})\/(join|ws)$/);
      if (match) {
        const room = env.ROOMS.get(env.ROOMS.idFromString(match[1]));
        if (match[2] === 'join' && req.method === 'POST') {
          const who = await user(req, env, true),
            b = await body(req);
          return room.fetch(
            new Request('https://room/join', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: b.name, user: who }),
            }),
          );
        }
        if (match[2] === 'ws' && req.method === 'GET') {
          const forwarded = new URL(req.url);
          forwarded.pathname = '/ws';
          return room.fetch(new Request(forwarded, req));
        }
      }
      return json({ error: '見つかりません' }, 404);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: '処理に失敗しました。設定と接続を確認してください' }, 500);
    }
  },
};
