import { readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const remote = process.argv.includes('--remote');
if (remote && !process.argv.includes('--confirm-production-upload'))
  throw new Error('Production upload requires --remote --confirm-production-upload');
const manifest = JSON.parse(await readFile('.cache/tts/runtime-manifest.json', 'utf8'));
if (process.argv.includes('--model')) {
  for (const name of ['model.onnx', 'model.onnx.json', 'approval.json']) {
    await stat(`.cache/tts/${name}`);
    manifest.push({ key: `tts/${name}`, path: `.cache/tts/${name}` });
  }
  const approval = JSON.parse(await readFile('.cache/tts/approval.json', 'utf8'));
  if (remote && approval.testOnly)
    throw new Error('Test-only models must not be installed in production');
  if (approval.reviewed !== true || !approval.credit || !approval.source || !approval.terms)
    throw new Error('Complete the model terms review and approval.json first');
}
for (const f of manifest) {
  const r = spawnSync(
    'npx',
    [
      'wrangler',
      'r2',
      'object',
      'put',
      `its-my-karta-media/${f.key}`,
      '--file',
      f.path,
      remote ? '--remote' : '--local',
      '--content-type',
      f.key.endsWith('.wasm')
        ? 'application/wasm'
        : f.key.endsWith('.json')
          ? 'application/json'
          : 'application/octet-stream',
    ],
    { stdio: 'inherit' },
  );
  if (r.status) process.exit(r.status);
}
