import { assert, readLimited, type Env } from './types';
export function sniff(b: Uint8Array, kind: string): string {
  const s = new TextDecoder('latin1').decode(b.subarray(0, 40));
  if (kind === 'image') {
    if (b[0] === 0x89 && s.slice(1, 4) === 'PNG') return 'image/png';
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') return 'image/webp';
  } else {
    if (s.startsWith('RIFF') && s.slice(8, 12) === 'WAVE') return 'audio/wav';
    if (s.startsWith('OggS')) return 'audio/ogg';
    if (s.startsWith('ID3') || (b[0] === 255 && (b[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'audio/webm';
    if (s.slice(4, 8) === 'ftyp') return 'audio/mp4';
  }
  throw new Error('対応していない画像・音声形式です');
}
export async function store(env: Env, bytes: Uint8Array, kind: string, type: string) {
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
  await env.MEDIA.put(`${kind}/${hash}`, bytes, {
    httpMetadata: { contentType: type, cacheControl: 'public,max-age=31536000,immutable' },
  });
  return `/api/media/${kind}/${hash}`;
}
export async function upload(req: Request, env: Env, kind: string) {
  assert(['image', 'audio'].includes(kind), 'ファイル種別が不正です');
  const bytes = await readLimited(req, kind === 'image' ? 3_000_000 : 5_000_000);
  let mime;
  try {
    mime = sniff(bytes, kind);
  } catch (e) {
    assert(false, (e as Error).message, 415);
  }
  return store(env, bytes, kind, mime!);
}
export async function serve(req: Request, env: Env, key: string) {
  assert(/^(image|audio)\/[a-f0-9]{64}$/.test(key), 'ファイルがありません', 404);
  const obj = await env.MEDIA.get(key, { range: req.headers, onlyIf: req.headers });
  assert(obj, 'ファイルがありません', 404);
  const headers = new Headers({ 'X-Content-Type-Options': 'nosniff' });
  obj.writeHttpMetadata(headers);
  headers.set('ETag', obj.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  if (!('body' in obj))
    return new Response(null, {
      status: req.headers.has('If-Match') || req.headers.has('If-Unmodified-Since') ? 412 : 304,
      headers,
    });
  let status = 200;
  if (req.headers.has('Range') && obj.range && 'offset' in obj.range) {
    const n = obj.range.length!;
    headers.set(
      'Content-Range',
      `bytes ${obj.range.offset}-${obj.range.offset! + n - 1}/${obj.size}`,
    );
    headers.set('Content-Length', String(n));
    status = 206;
  } else headers.set('Content-Length', String(obj.size));
  return new Response(req.method === 'HEAD' ? null : obj.body, { status, headers });
}
