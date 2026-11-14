import test from 'node:test';
import assert from 'node:assert/strict';
import { cards, rules, KANA, readLimited, HttpError } from '../src/types';
import { sniff } from '../src/media';
import { VOICES } from '../src/voicevox-catalog';
const c = { kana: 'あ', text: 'あさ', image: '/api/media/image/' + 'a'.repeat(64) };
test('46音、空の下書き、対戦の最低枚数を検証', () => {
  assert.equal(KANA.length, 46);
  assert.deepEqual(cards([]), []);
  assert.throws(() => cards([], 2));
  assert.equal(cards([c])[0].id, 'あ');
});
test('重複・外部画像・SVG・過大な文章・不正な音声を拒否', () => {
  for (const list of [
    [c, c],
    [{ ...c, image: 'https://evil.test/a.png' }],
    [{ ...c, image: 'data:image/svg+xml,a' }],
    [{ ...c, text: 'あ'.repeat(201) }],
    [{ ...c, audio: 'javascript:alert(1)' }],
  ])
    assert.throws(() => cards(list));
});
test('勝利条件と制限時間を検証', () => {
  assert.equal(
    rules({ mode: 'all', memorizeSeconds: 0, durationSeconds: 60, target: 1 }).mode,
    'all',
  );
  for (const b of [
    { mode: 'other' },
    { mode: 'time', memorizeSeconds: -1, durationSeconds: 60, target: 1 },
    { mode: 'target', memorizeSeconds: 0, durationSeconds: 60, target: 47 },
  ])
    assert.throws(() => rules(b));
});
test('ファイル実体を判定しSVG/HTMLを拒否', () => {
  assert.equal(sniff(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), 'image'), 'image/png');
  assert.equal(sniff(new TextEncoder().encode('RIFFxxxxWAVEfmt '), 'audio'), 'audio/wav');
  assert.throws(() => sniff(new TextEncoder().encode('<svg onload="alert(1)">'), 'image'));
});
test('Content-Lengthのない過大なストリームも拒否', async () => {
  await assert.rejects(
    readLimited(new Request('https://x', { method: 'POST', body: 'abcdef' }), 3),
    (e: HttpError) => e.status === 413,
  );
});
test('商用利用に個別確認が必要な7キャラクターは選択不可、指定creditあり', () => {
  assert.equal(VOICES.length, 37);
  for (const v of VOICES) {
    assert.match(v.credit, /^VOICEVOX:/);
    assert.ok(v.terms.startsWith('http'));
    assert.ok(
      !['Voidoll', 'ぞん子', 'もち子さん', '後鬼', '青山龍星', 'ユーレイちゃん', 'No7'].includes(
        v.name,
      ),
    );
  }
});
