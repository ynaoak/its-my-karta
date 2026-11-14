import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const revision = '035fb7aecf096c40e50493ac25b822e89553c7d6';
const out = '.cache/tts-fixture';
await mkdir(out, { recursive: true });
let dir = process.env.TEST_MODEL_DIR;
if (!dir) {
  const repo = out + '/source';
  await mkdir(repo, { recursive: true });
  for (const args of [
    ['init', '--bare', repo],
    ['-C', repo, 'fetch', '--depth', '1', 'https://github.com/ayutaz/piper-plus.git', revision],
  ]) {
    const r = spawnSync('git', args, { stdio: 'inherit' });
    if (r.status) process.exit(r.status);
  }
  for (const name of ['multilingual-test-medium.onnx', 'multilingual-test-medium.onnx.json']) {
    const r = spawnSync(
      'git',
      ['-C', repo, 'show', `${revision}:src/wasm/openjtalk-web/models/${name}`],
      { maxBuffer: 60_000_000 },
    );
    if (r.status) throw new Error('Fixture retrieval failed');
    await writeFile(`${out}/${name}`, r.stdout);
  }
  dir = out;
}
for (const [name, sha] of [
  [
    'multilingual-test-medium.onnx',
    '375694f9a9c24d57ebbccfff7e16b20a3775a926754603f34123744d2e4d9d2a',
  ],
  [
    'multilingual-test-medium.onnx.json',
    '924f456f6085bee21306171e2d4262f5724f089f241ebccb50e465eaebf217a8',
  ],
]) {
  const b = await readFile(`${dir}/${name}`);
  if (createHash('sha256').update(b).digest('hex') !== sha)
    throw new Error('Fixture SHA256 mismatch');
  await writeFile(`${out}/${name}`, b);
}
const config = JSON.parse(await readFile(`${out}/multilingual-test-medium.onnx.json`, 'utf8'));
if (config.language_id_map.ja !== 0) throw new Error('Unexpected Japanese language ID');
config.language_id_map = { ja: 0 };
config.num_languages = 1;
await writeFile(out + '/ja-only.json', JSON.stringify(config));
console.log('Verified upstream test fixture. This is not a production voice model.');
