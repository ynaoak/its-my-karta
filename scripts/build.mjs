import { build } from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
await mkdir('public/vendor', { recursive: true });
await mkdir('.cache/tts/runtime', { recursive: true });
await mkdir('public/assets', { recursive: true });
for (const f of ['pinyin_single.json', 'pinyin_phrases.json'])
  await copyFile(`node_modules/piper-plus/assets/${f}`, `public/assets/${f}`);
await copyFile(
  'node_modules/piper-plus/dist/rust-wasm/piper_plus_wasm.js',
  'public/vendor/piper_plus_wasm.js',
);
const runtime = [
  ['node_modules/piper-plus/dist/rust-wasm/piper_plus_wasm_bg.wasm', 'g2p.wasm'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.wasm'],
];
const manifest = [];
for (const [src, name] of runtime) {
  await copyFile(src, `.cache/tts/runtime/${name}`);
  manifest.push({
    key: `tts/runtime/${name}`,
    path: `.cache/tts/runtime/${name}`,
    sha256: createHash('sha256')
      .update(await readFile(src))
      .digest('hex'),
  });
}
await copyFile(
  'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',
  'public/vendor/ort-wasm-simd-threaded.mjs',
);
await copyFile('node_modules/piper-plus/LICENSE.md', 'public/vendor/PIPER-LICENSE.md');
await copyFile(
  'node_modules/piper-plus/THIRD-PARTY-LICENSES.md',
  'public/vendor/PIPER-THIRD-PARTY-LICENSES.md',
);
await copyFile('docs/licenses/ONNX-Runtime-LICENSE.txt', 'public/vendor/ORT-LICENSE');
await writeFile('.cache/tts/runtime-manifest.json', JSON.stringify(manifest, null, 2));
await build({
  entryPoints: ['browser/tts-worker.js'],
  outfile: 'public/tts-worker.js',
  bundle: true,
  external: ['/vendor/*'],
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
});
console.log(
  'Worker bundled. Large WASM runtime files are in .cache/tts/runtime; install into R2 using scripts/install-tts.mjs.',
);
