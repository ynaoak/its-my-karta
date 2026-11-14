let worker = null,
  rejectPending = null,
  timer = null,
  generation = 0;
export function cancelLocal() {
  generation++;
  clearTimeout(timer);
  timer = null;
  worker?.terminate();
  worker = null;
  rejectPending?.(new Error('音声生成を中止しました'));
  rejectPending = null;
}
export async function generateLocal(text, onProgress) {
  cancelLocal();
  const gen = generation;
  const r = await fetch('/api/tts/config');
  const config = await r.json();
  if (gen !== generation) throw new Error('音声生成を中止しました');
  if (!r.ok || !config.ready)
    throw new Error(config.message || config.error || 'WASM音声モデルが未設定です');
  return new Promise((resolve, reject) => {
    rejectPending = reject;
    worker = new Worker('/tts-worker.js', { type: 'module' });
    timer = setTimeout(cancelLocal, 180000);
    const done = () => {
      clearTimeout(timer);
      timer = null;
      worker?.terminate();
      worker = null;
      rejectPending = null;
    };
    worker.onmessage = ({ data }) => {
      if (gen !== generation) return;
      if (data.type === 'progress') onProgress(data.message);
      if (data.type === 'error') {
        done();
        reject(new Error(data.message));
      }
      if (data.type === 'done') {
        done();
        resolve({ wav: data.wav, credit: config.credit });
      }
    };
    worker.onerror = (e) => {
      done();
      reject(new Error(e.message || 'WASMの起動に失敗しました'));
    };
    worker.postMessage({ text });
  });
}
