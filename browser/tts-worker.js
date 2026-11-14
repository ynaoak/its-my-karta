import { PiperPlus } from 'piper-plus';
import * as ort from 'onnxruntime-web/wasm';
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = {
  mjs: new URL('/vendor/ort-wasm-simd-threaded.mjs', self.location.href).href,
  wasm: new URL('/api/tts/runtime/ort-wasm-simd-threaded.wasm', self.location.href).href,
};
let piper;
self.onmessage = async ({ data }) => {
  try {
    if (typeof data.text !== 'string' || data.text.length < 1 || data.text.length > 200)
      throw new Error('読み札は1〜200文字です');
    piper ||= await PiperPlus.initialize({
      model: new URL('/api/tts/assets/model.onnx', self.location.href).href,
      ort,
      wasmLoader: async () => {
        const m = await import('/vendor/piper_plus_wasm.js');
        await m.default({
          module_or_path: new URL('/api/tts/runtime/g2p.wasm', self.location.href),
        });
        return m;
      },
      onProgress: ({ stage, progress }) =>
        postMessage({ type: 'progress', message: `${stage} ${Math.round(progress * 100)}%` }),
    });
    const result = await piper.synthesize(data.text, { language: 'ja' });
    if (
      result.duration > 45 ||
      result.samples.length < 100 ||
      !result.samples.every(Number.isFinite) ||
      !result.samples.some((s) => Math.abs(s) > 0.00001)
    )
      throw new Error('有効な音声が生成されませんでした');
    const wav = result.toWav();
    postMessage({ type: 'done', wav }, [wav]);
  } catch (e) {
    postMessage({ type: 'error', message: e.message });
  }
};
