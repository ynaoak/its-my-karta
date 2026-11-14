import { assert, body, cards, checkMedia, json, type Env } from './types';
export async function decks(req: Request, env: Env, owner: string, path: string) {
  assert(env.DB, 'D1が未設定です', 503);
  const id = path.split('/')[3];
  const url = new URL(req.url);
  if (!id && req.method === 'GET') {
    const cursor = url.searchParams.get('cursor');
    let t = Number.MAX_SAFE_INTEGER,
      k = '~';
    if (cursor) {
      try {
        [t, k] = JSON.parse(atob(cursor));
      } catch {
        assert(false, 'ページ指定が不正です');
      }
      assert(Number.isSafeInteger(t) && typeof k === 'string', 'ページ指定が不正です');
    }
    const rows = await env.DB.prepare(
      'SELECT id,title,revision,created_at,updated_at,json_array_length(cards_json) AS count FROM decks WHERE owner_user_id=? AND (updated_at < ? OR (updated_at = ? AND id < ?)) ORDER BY updated_at DESC,id DESC LIMIT 21',
    )
      .bind(owner, t, t, k)
      .all();
    const list = rows.results.slice(0, 20),
      last = list.at(-1);
    return json({
      decks: list,
      nextCursor:
        rows.results.length > 20 && last ? btoa(JSON.stringify([last.updated_at, last.id])) : null,
    });
  }
  if (!id && req.method === 'POST') {
    const b = await body(req),
      list = cards(b.cards);
    assert(
      typeof b.title === 'string' && b.title.trim().length >= 1 && b.title.trim().length <= 80,
      'タイトルは1〜80文字です',
    );
    await checkMedia(env, list);
    const key = crypto.randomUUID(),
      now = Date.now();
    await env.DB.prepare(
      'INSERT INTO decks(id,owner_user_id,title,cards_json,created_at,updated_at) VALUES(?,?,?,?,?,?)',
    )
      .bind(key, owner, b.title.trim(), JSON.stringify(list), now, now)
      .run();
    return json(
      {
        id: key,
        title: b.title.trim(),
        cards: list,
        revision: 1,
        created_at: now,
        updated_at: now,
      },
      201,
    );
  }
  assert(id && /^[a-f0-9-]{36}$/.test(id), 'かるたがありません', 404);
  const row = await env.DB.prepare('SELECT * FROM decks WHERE id=? AND owner_user_id=?')
    .bind(id, owner)
    .first<any>();
  assert(row, 'かるたがありません', 404);
  if (req.method === 'GET')
    return json({
      ...row,
      owner_user_id: undefined,
      cards_json: undefined,
      cards: JSON.parse(row.cards_json),
    });
  if (req.method === 'PUT') {
    const b = await body(req),
      list = cards(b.cards);
    assert(
      typeof b.title === 'string' && b.title.trim().length >= 1 && b.title.trim().length <= 80,
      'タイトルは1〜80文字です',
    );
    assert(Number.isInteger(b.revision), '版番号が必要です');
    await checkMedia(env, list);
    const now = Math.max(Date.now(), row.updated_at + 1);
    const result = await env.DB.prepare(
      'UPDATE decks SET title=?,cards_json=?,revision=revision+1,updated_at=? WHERE id=? AND owner_user_id=? AND revision=?',
    )
      .bind(b.title.trim(), JSON.stringify(list), now, id, owner, b.revision)
      .run();
    assert(
      result.meta.changes === 1,
      '他の画面で更新されています。一覧から読み直すか、別名保存してください',
      409,
    );
    return json({
      id,
      title: b.title.trim(),
      cards: list,
      revision: b.revision + 1,
      created_at: row.created_at,
      updated_at: now,
    });
  }
  if (req.method === 'DELETE') {
    const revision = Number(req.headers.get('If-Match'));
    assert(revision > 0, 'If-Match版番号が必要です', 428);
    const r = await env.DB.prepare(
      'DELETE FROM decks WHERE id=? AND owner_user_id=? AND revision=?',
    )
      .bind(id, owner, revision)
      .run();
    assert(r.meta.changes === 1, '他の画面で更新されています', 409);
    return json({ ok: true });
  }
  return json({ error: '対応していない操作です' }, 405);
}
