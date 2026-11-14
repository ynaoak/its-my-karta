import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { setup } from './harness.mjs';
const { mf, tokens } = await setup();
let browser;
try {
  const bucket = await mf.getR2Bucket('MEDIA');
  for (const name of ['g2p.wasm', 'ort-wasm-simd-threaded.wasm'])
    await bucket.put('tts/runtime/' + name, await readFile('.cache/tts/runtime/' + name), {
      httpMetadata: { contentType: 'application/wasm' },
    });
  await bucket.put(
    'tts/model.onnx',
    await readFile('.cache/tts-fixture/multilingual-test-medium.onnx'),
  );
  await bucket.put('tts/model.onnx.json', await readFile('.cache/tts-fixture/ja-only.json'));
  await bucket.put(
    'tts/approval.json',
    JSON.stringify({
      reviewed: true,
      testOnly: true,
      model: 'tsukuyomi',
      credit: 'TEST FIXTURE ONLY — not approved for production',
    }),
  );
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : chromium.executablePath()),
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  const origin = (await mf.ready).origin;
  const external = [];
  await page.route('**/*', (r) => {
    if (new URL(r.request().url()).origin !== origin) {
      external.push(r.request().url());
      return r.abort();
    }
    return r.continue();
  });
  await page.goto(origin + '/');
  const result = await page.evaluate(async (token) => {
    window.speechSynthesis.speak = () => {
      throw new Error('Speech API must not synthesize this test');
    };
    const start = performance.now();
    const { generateLocal } = await import('/local-tts.js');
    const generated = await generateLocal('こんにちは。みんなでかるたをしましょう。', (message) =>
      console.log(message),
    );
    const bytes = new Uint8Array(generated.wav),
      view = new DataView(generated.wav);
    if (new TextDecoder().decode(bytes.subarray(0, 4)) !== 'RIFF') throw new Error('Not WAV');
    let peak = 0;
    for (let i = 44; i + 1 < bytes.length; i += 2)
      peak = Math.max(peak, Math.abs(view.getInt16(i, true)));
    if (!peak) throw new Error('Silent WAV');
    const rate = view.getUint32(24, true),
      duration = (bytes.length - 44) / 2 / rate;
    const response = await fetch('/api/upload/audio', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'audio/wav' },
      body: generated.wav,
    });
    const b = await response.json();
    if (!response.ok) throw new Error(b.error);
    const saved = await (await fetch(b.url)).arrayBuffer();
    if (saved.byteLength !== bytes.length) throw new Error('R2 bytes differ');
    const audio = new Audio(b.url);
    await audio.play();
    await new Promise((r) => setTimeout(r, 200));
    const played = audio.currentTime;
    audio.pause();
    return {
      bytes: bytes.length,
      rate,
      duration,
      peak,
      played,
      elapsedMs: Math.round(performance.now() - start),
      externalTtsRequests: 0,
    };
  }, tokens.user_host);
  assert.ok(result.duration > 0 && result.played > 0);
  await mkdir('.cache/evidence', { recursive: true });
  await writeFile('.cache/evidence/wasm.json', JSON.stringify(result, null, 2));
  console.log(
    'PASS actual Japanese WASM inference -> WAV -> authenticated R2 upload -> HTMLAudio playback',
    result,
  );
} finally {
  await browser?.close();
  await mf.dispose();
}
