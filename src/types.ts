export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  MEDIA: R2Bucket;
  ROOMS: DurableObjectNamespace;
  CLERK_PUBLISHABLE_KEY?: string;
  CLERK_JWT_KEY?: string;
  CLERK_AUTHORIZED_PARTIES?: string;
  VOICEVOX_ENGINE_URL?: string;
  VOICEVOX_API_KEY?: string;
}
export interface Card {
  id: string;
  kana: string;
  text: string;
  image: string;
  audio?: string;
  audioText?: string;
  credit?: string;
}
export interface Rules {
  mode: 'all' | 'time' | 'target';
  memorizeSeconds: number;
  durationSeconds: number;
  target: number;
}
export const KANA = [
  ...'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん',
];
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  });
}
export function assert(value: unknown, message: string, status = 400): asserts value {
  if (!value) throw new HttpError(status, message);
}
export function mediaPath(value: unknown, kind: string): value is string {
  return typeof value === 'string' && new RegExp(`^/api/media/${kind}/[a-f0-9]{64}$`).test(value);
}
export function cards(value: unknown, min = 0): Card[] {
  assert(
    Array.isArray(value) && value.length >= min && value.length <= KANA.length,
    `札は${min}〜46枚にしてください`,
  );
  const seen = new Set<string>();
  return value.map((c) => {
    assert(c && typeof c === 'object', '札が不正です');
    assert(KANA.includes(c.kana) && !seen.has(c.kana), 'かなは重複できません');
    seen.add(c.kana);
    assert(
      typeof c.text === 'string' && c.text.trim().length > 0 && c.text.length <= 200,
      '読み札は1〜200文字です',
    );
    assert(mediaPath(c.image, 'image'), '画像をアップロードしてください');
    assert(c.audio === undefined || mediaPath(c.audio, 'audio'), '音声URLが不正です');
    assert(
      c.credit === undefined || (typeof c.credit === 'string' && c.credit.length <= 500),
      'クレジットが不正です',
    );
    assert(
      c.audioText === undefined || (typeof c.audioText === 'string' && c.audioText.length <= 200),
      '音声テキストが不正です',
    );
    return {
      id: c.kana,
      kana: c.kana,
      text: c.text.trim(),
      image: c.image,
      ...(c.audio ? { audio: c.audio, audioText: c.audioText, credit: c.credit } : {}),
    };
  });
}
export function rules(v: any): Rules {
  assert(v && ['all', 'time', 'target'].includes(v.mode), '勝利条件が不正です');
  for (const [key, min, max] of [
    ['memorizeSeconds', 0, 1800],
    ['durationSeconds', 10, 3600],
    ['target', 1, 46],
  ] as const) {
    assert(Number.isInteger(v[key]) && v[key] >= min && v[key] <= max, `${key}が範囲外です`);
  }
  return {
    mode: v.mode,
    memorizeSeconds: v.memorizeSeconds,
    durationSeconds: v.durationSeconds,
    target: v.target,
  };
}
export async function body(req: Request, max = 100_000): Promise<any> {
  assert(req.headers.get('content-type')?.startsWith('application/json'), 'JSONが必要です', 415);
  const bytes = await readLimited(req, max);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, 'JSONが不正です');
  }
}
export async function readLimited(
  req: { body: ReadableStream<Uint8Array> | null },
  max: number,
): Promise<Uint8Array> {
  const r = req.body?.getReader();
  assert(r, '本文が必要です');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const x = await r.read();
    if (x.done) break;
    size += x.value.length;
    if (size > max) {
      await r.cancel();
      throw new HttpError(413, 'ファイルが大きすぎます');
    }
    chunks.push(x.value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
export async function checkMedia(env: Env, list: Card[]) {
  const paths = [...new Set(list.flatMap((c) => [c.image, ...(c.audio ? [c.audio] : [])]))];
  const objects = await Promise.all(paths.map((p) => env.MEDIA.head(p.replace('/api/media/', ''))));
  assert(objects.every(Boolean), '参照先の画像・音声がありません');
}
