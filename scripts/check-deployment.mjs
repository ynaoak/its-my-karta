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
const db = config.d1_databases?.find((entry) => entry.binding === 'DB');
if (!db?.database_name) missing.push('DB binding の database_name を設定してください');
if (
  !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(db?.database_id || '')
) {
  missing.push('D1作成時の実際の database_id を DB binding に設定してください');
}
const bucket = config.r2_buckets?.find((entry) => entry.binding === 'MEDIA');
if (!bucket?.bucket_name || /REPLACE|YOUR_|EXAMPLE/i.test(bucket.bucket_name)) {
  missing.push('MEDIA binding に実際のR2 bucket_nameを設定してください');
}
if (
  !config.durable_objects?.bindings?.some(
    (entry) => entry.name === 'ROOMS' && entry.class_name === 'KarutaRoom',
  )
) {
  missing.push('ROOMS binding に KarutaRoom を設定してください');
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
  console.log('次に npm run db:migrate:remote、npm run deploy を実行できます。');
  console.log(
    'この確認はリモートリソースの存在・権限・Clerk secretsの設定を検証しません。docs/DEPLOYMENT.mdを確認してください。',
  );
}
