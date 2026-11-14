import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const script = fileURLToPath(new URL('../scripts/check-deployment.mjs', import.meta.url));
const id = 'e50c66ae-c3b7-43aa-a67a-d65a7f758d6e';
async function check(database, { previews, preview = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'karuta-deploy-check-'));
  try {
    await mkdir(join(root, 'public/vendor'), { recursive: true });
    for (const file of [
      'public/tts-worker.js',
      'public/vendor/piper_plus_wasm.js',
      'public/vendor/ort-wasm-simd-threaded.mjs',
    ])
      await writeFile(join(root, file), '// fixture');
    await writeFile(
      join(root, 'wrangler.jsonc'),
      JSON.stringify({
        assets: { directory: 'public' },
        previews,
        d1_databases: database ? [{ binding: 'DB', ...database }] : [],
        r2_buckets: [{ binding: 'MEDIA', bucket_name: 'its-my-karta-media' }],
        durable_objects: { bindings: [{ name: 'ROOMS', class_name: 'KarutaRoom' }] },
      }),
    );
    const result = spawnSync(process.execPath, [script, ...(preview ? ['--preview'] : [])], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.ifError(result.error);
    return result;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test('既存D1を名前だけで指定した設定は通る', async () => {
  const r = await check({ database_name: 'its-my-karta-db' });
  assert.equal(r.status, 0, r.stderr);
});
test('D1のUUIDだけでも指定できる', async () => {
  const r = await check({ database_id: id });
  assert.equal(r.status, 0, r.stderr);
});
test('D1の名前とUUIDの両方がある設定も通る', async () => {
  const r = await check({ database_name: 'its-my-karta-db', database_id: id });
  assert.equal(r.status, 0, r.stderr);
});
test('名前があっても不正なUUIDは拒否する', async () => {
  for (const database_id of ['', null, 42, 'REPLACE_ME']) {
    const r = await check({ database_name: 'its-my-karta-db', database_id });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /database_id/);
  }
});
test('D1 binding・名前・IDがない設定は拒否する', async () => {
  for (const database of [null, {}, { database_name: '  ' }]) {
    const r = await check(database);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /database_name または database_id/);
  }
});

const safePreviews = {
  d1_databases: [{ binding: 'DB', database_name: 'its-my-karta-db-preview', database_id: id }],
  r2_buckets: [{ binding: 'MEDIA', bucket_name: 'its-my-karta-media-preview' }],
  durable_objects: { bindings: [{ name: 'ROOMS', class_name: 'KarutaRoom' }] },
};
test('previewsブロックで別リソースを指定するとプレビュー確認は通る', async () => {
  const r = await check(
    { database_name: 'its-my-karta-db' },
    { previews: safePreviews, preview: true },
  );
  assert.equal(r.status, 0, r.stderr);
});
test('previewsブロックの欠落を検出する', async () => {
  const r = await check({ database_name: 'its-my-karta-db' }, { preview: true });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /previews/);
});
test('プレビューの本番D1参照を拒否する', async () => {
  const previews = {
    ...safePreviews,
    d1_databases: [{ binding: 'DB', database_name: 'its-my-karta-db' }],
  };
  const r = await check({ database_name: 'its-my-karta-db' }, { previews, preview: true });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /本番D1/);
});
test('プレビューの本番R2参照を拒否する', async () => {
  const previews = {
    ...safePreviews,
    r2_buckets: [{ binding: 'MEDIA', bucket_name: 'its-my-karta-media' }],
  };
  const r = await check({ database_name: 'its-my-karta-db' }, { previews, preview: true });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /本番R2/);
});
test('プレビューの外部Durable Object参照を拒否する', async () => {
  const previews = {
    ...safePreviews,
    durable_objects: {
      bindings: [{ name: 'ROOMS', class_name: 'KarutaRoom', script_name: 'its-my-karta' }],
    },
  };
  const r = await check({ database_name: 'its-my-karta-db' }, { previews, preview: true });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /script_name/);
});

test('Preview APIへ名前だけのD1 bindingを送る設定は事前に拒否する', async () => {
  const previews = structuredClone(safePreviews);
  delete previews.d1_databases[0].database_id;
  const r = await check({ database_name: 'its-my-karta-db' }, { previews, preview: true });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Preview API.*database_id/);
});
test('名前が異なってもPreviewに本番D1のIDを指定することを拒否する', async () => {
  const r = await check(
    { database_name: 'its-my-karta-db', database_id: id },
    { previews: safePreviews, preview: true },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /本番D1/);
});
