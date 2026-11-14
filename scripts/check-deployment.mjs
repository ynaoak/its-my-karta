import ts from 'typescript';
import { readFile, stat, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const index = process.argv.indexOf('--config');
const configPath = index < 0 ? 'wrangler.jsonc' : process.argv[index + 1];
if (!configPath) throw new Error('--config に設定ファイルを指定してください');
const source = await readFile(configPath, 'utf8');
const parsed = ts.parseConfigFileTextToJson(configPath, source);
if (parsed.error) throw new Error('Wrangler設定のJSONCを読み取れません');
const config = parsed.config;
const missing = [];
const preview = process.argv.includes('--preview');
const bindings = preview ? config.previews || {} : config;
if (preview && !config.previews) missing.push('プレビュー用の previews ブロックを設定してください');
const db = bindings.d1_databases?.find((entry) => entry.binding === 'DB');
const databaseName = typeof db?.database_name === 'string' ? db.database_name.trim() : '';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hasDatabaseId = db?.database_id !== undefined;
if (preview && !hasDatabaseId) {
  missing.push(
    'Preview APIのDB bindingには database_id（UUID）が必須です。database_nameだけではデプロイできません',
  );
}
// Normal deploys resolve D1 by name. The Preview deployment API instead requires database_id.
// An explicitly supplied invalid ID must still fail, rather than falling back silently.
if (hasDatabaseId && (typeof db.database_id !== 'string' || !uuid.test(db.database_id))) {
  missing.push(
    preview
      ? 'Preview DB binding の database_id を実際のUUIDに修正してください'
      : 'DB binding の database_id を実際のUUIDに修正するか、database_nameで指定してください',
  );
}
if (!databaseName && !hasDatabaseId) {
  missing.push('DB binding に database_name または database_id を設定してください');
}
const bucket = bindings.r2_buckets?.find((entry) => entry.binding === 'MEDIA');
if (!bucket?.bucket_name || /REPLACE|YOUR_|EXAMPLE/i.test(bucket.bucket_name)) {
  missing.push('MEDIA binding に実際のR2 bucket_nameを設定してください');
}
if (
  !bindings.durable_objects?.bindings?.some(
    (entry) => entry.name === 'ROOMS' && entry.class_name === 'KarutaRoom',
  )
) {
  missing.push('ROOMS binding に KarutaRoom を設定してください');
}
if (preview) {
  const productionDB = config.d1_databases?.find((entry) => entry.binding === 'DB');
  const productionBucket = config.r2_buckets?.find((entry) => entry.binding === 'MEDIA');
  if (
    (databaseName && databaseName === productionDB?.database_name) ||
    (db?.database_id && db.database_id === productionDB?.database_id)
  ) {
    missing.push('プレビューには本番D1と別のデータベースを設定してください');
  }
  if (bucket?.bucket_name && bucket.bucket_name === productionBucket?.bucket_name) {
    missing.push('プレビューには本番R2と別のバケットを設定してください');
  }
  const room = bindings.durable_objects?.bindings?.find((entry) => entry.name === 'ROOMS');
  if (room?.script_name || room?.environment)
    missing.push(
      'プレビューのROOMSはscript_nameやenvironmentを省略し、独立したDurable Objectを使用してください',
    );
}
for (const file of [
  'public/tts-worker.js',
  'public/vendor/piper_plus_wasm.js',
  'public/vendor/ort-wasm-simd-threaded.mjs',
]) {
  try {
    await stat(file);
  } catch {
    missing.push(`${file} がありません。先に npm run build を実行してください`);
  }
}
// Workers Static Assets permits at most 25 MiB per file. Large runtime/model blobs belong in R2.
async function inspectAssets(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      missing.push(`Static Assetsにシンボリックリンクがあります: ${path}`);
      continue;
    }
    if (entry.isDirectory()) await inspectAssets(path);
    else if ((await stat(path)).size > 25 * 1024 * 1024)
      missing.push(`25 MiBを超えるファイルをR2に移してください: ${path}`);
  }
}
if (config.assets?.directory) {
  try {
    await inspectAssets(resolve(config.assets.directory));
  } catch {
    missing.push('Static Assetsのディレクトリを確認してください');
  }
} else missing.push('Static Assetsのdirectoryを設定してください');
if (missing.length) {
  console.error('デプロイ準備が未完了です:\n' + missing.map((line) => `- ${line}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('ローカルのデプロイ設定・ビルド成果物を確認しました。');
  console.log(
    preview
      ? '次に npm run deploy:preview を実行できます。'
      : '次に npm run db:migrate:remote、npm run deploy を実行できます。',
  );
  console.log(
    'この確認はリモートリソースの存在・権限・Clerk secretsの設定を検証しません。docs/DEPLOYMENT.mdを確認してください。',
  );
}
