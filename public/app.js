import { generateLocal, cancelLocal } from './local-tts.js';
const $ = (id) => document.getElementById(id),
  KANA = [
    ...'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん',
  ];
let clerk = null,
  account = null,
  epoch = 0,
  draft = { title: 'わたしのかるた', cards: [], edits: {}, active: null },
  selected = 'あ',
  busy = false,
  recorder = null,
  recordStream = null;
let socket = null,
  playerId = null,
  roomId = null,
  game = null,
  lastRound = -1,
  sound = false,
  playback = null,
  playbackUrl = null,
  clockSkew = 0,
  libraryCursor = null,
  voices = [];
function notice(message) {
  $('notice').textContent = message;
}
function error(e) {
  notice(e.message || String(e));
}
function key() {
  return `karuta-draft:${account || 'guest'}`;
}
function persist() {
  try {
    localStorage.setItem(key(), JSON.stringify(draft));
  } catch {
    notice(
      '端末の保存容量が不足しています。「この札を保存」でメディアをR2へ保存してから再試行してください',
    );
  }
}
function edit() {
  return (draft.edits[selected] ||= structuredClone(
    draft.cards.find((c) => c.kana === selected) || {
      id: selected,
      kana: selected,
      text: '',
      image: '',
    },
  ));
}
function updateInputs() {
  const e = edit();
  $('selected-kana').textContent = selected;
  $('card-text').value = e.text || '';
  $('preview').src = e.image || '';
  $('preview').hidden = !e.image;
  $('image-placeholder').hidden = !!e.image;
  $('audio-credit').value = e.credit || '';
  $('audio-state').textContent = e.audio ? '個別音声あり' : '個別音声なし';
  renderKana();
}
function renderKana() {
  for (const b of $('kana-grid').children) {
    b.classList.toggle('selected', b.textContent === selected);
    b.classList.toggle(
      'saved',
      draft.cards.some((c) => c.kana === b.textContent),
    );
    b.setAttribute('aria-pressed', String(b.textContent === selected));
  }
  $('card-count').textContent = `${draft.cards.length} / 46 枚`;
}
function renderDraft() {
  $('deck-title').value = draft.title;
  $('active-deck').textContent = draft.active
    ? `クラウド保存済み・版 ${draft.active.revision}`
    : '未保存のかるた';
  updateInputs();
}
function restore() {
  try {
    const d = JSON.parse(localStorage.getItem(key()) || 'null');
    draft =
      d && Array.isArray(d.cards)
        ? d
        : { title: 'わたしのかるた', cards: [], edits: {}, active: null };
    draft.edits ||= {};
  } catch {
    draft = { title: 'わたしのかるた', cards: [], edits: {}, active: null };
  }
  selected = 'あ';
  renderDraft();
}
async function token() {
  return clerk?.session?.getToken() || null;
}
async function api(path, { method = 'GET', data, raw, headers = {} } = {}) {
  const gen = epoch,
    auth = await token();
  guarded(gen);
  if (auth) headers.Authorization = `Bearer ${auth}`;
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(path, {
    method,
    headers,
    body: raw ?? (data === undefined ? undefined : JSON.stringify(data)),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(b.error || `通信エラー ${r.status}`);
  return b;
}
function signedIn() {
  if (!account) throw new Error('札の保存・対戦の作成にはログインしてください');
}
async function act(fn) {
  if (busy) return;
  busy = true;
  for (const b of document.querySelectorAll('button[data-lock]')) b.disabled = true;
  try {
    await fn();
  } catch (e) {
    error(e);
  } finally {
    busy = false;
    for (const b of document.querySelectorAll('button[data-lock]')) b.disabled = false;
  }
}
function guarded(gen) {
  if (gen !== epoch) throw new Error('ログイン状態が変わったため操作を中止しました');
}
async function upload(value, kind) {
  if (!value || value.startsWith('/api/media/')) return value;
  const blob = await (await fetch(value)).blob();
  return (
    await api(`/api/upload/${kind}`, {
      method: 'POST',
      raw: blob,
      headers: { 'Content-Type': blob.type },
    })
  ).url;
}
async function committedCards() {
  signedIn();
  const gen = epoch;
  const list = structuredClone(draft.cards);
  for (const c of list) {
    c.image = await upload(c.image, 'image');
    if (c.audio) c.audio = await upload(c.audio, 'audio');
    guarded(gen);
  }
  return list;
}
async function saveCard() {
  signedIn();
  const gen = epoch,
    kana = selected,
    e = structuredClone(edit());
  if (!e.text?.trim() || !e.image) throw new Error('ことばと画像を設定してください');
  e.image = await upload(e.image, 'image');
  if (e.audio) e.audio = await upload(e.audio, 'audio');
  guarded(gen);
  draft.cards = draft.cards.filter((c) => c.kana !== kana);
  draft.cards.push(e);
  draft.edits[kana] = e;
  persist();
  updateInputs();
  notice(`「${kana}」の札を保存しました`);
}
function switchTab(play) {
  $('editor-screen').hidden = play;
  $('play-screen').hidden = !play;
  $('editor-tab').setAttribute('aria-selected', String(!play));
  $('play-tab').setAttribute('aria-selected', String(play));
}
$('editor-tab').onclick = () => switchTab(false);
$('play-tab').onclick = () => switchTab(true);
for (const kana of KANA) {
  const b = document.createElement('button');
  b.textContent = kana;
  b.onclick = () => {
    selected = kana;
    updateInputs();
  };
  $('kana-grid').append(b);
}
$('card-text').oninput = () => {
  edit().text = $('card-text').value;
  persist();
};
$('audio-credit').oninput = () => {
  edit().credit = $('audio-credit').value;
  persist();
};
$('deck-title').oninput = () => {
  draft.title = $('deck-title').value;
  persist();
};
$('save-card').onclick = () => act(saveCard);
$('save-card').dataset.lock = '';
$('remove-card').onclick = () => {
  if (!confirm(`「${selected}」の札を削除しますか？`)) return;
  draft.cards = draft.cards.filter((c) => c.kana !== selected);
  delete draft.edits[selected];
  persist();
  updateInputs();
};
function readData(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('ファイルを読めません'));
    r.readAsDataURL(file);
  });
}
async function imageData(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 15_000_000)
    throw new Error('15MB以下のPNG/JPEG/WebPを選んでください');
  const bitmap = await createImageBitmap(file);
  const c = document.createElement('canvas'),
    ratio = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
  c.width = Math.max(1, Math.round(bitmap.width * ratio));
  c.height = Math.max(1, Math.round(bitmap.height * ratio));
  c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
  bitmap.close();
  return c.toDataURL('image/webp', 0.85);
}
$('image-file').onchange = async (e) => {
  const gen = epoch,
    kana = selected;
  try {
    const file = e.target.files[0];
    if (!file) return;
    const value = await imageData(file);
    guarded(gen);
    (draft.edits[kana] ||= { kana, id: kana, text: '' }).image = value;
    persist();
    updateInputs();
  } catch (e) {
    error(e);
  } finally {
    $('image-file').value = '';
  }
};
$('audio-file').onchange = async (e) => {
  const gen = epoch,
    kana = selected;
  try {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 5_000_000) throw new Error('音声は5MB以下にしてください');
    signedIn();
    const value = (
      await api('/api/upload/audio', {
        method: 'POST',
        raw: f,
        headers: { 'Content-Type': f.type },
      })
    ).url;
    guarded(gen);
    draft.edits[kana].audio = value;
    draft.edits[kana].audioText = draft.edits[kana].text;
    persist();
    updateInputs();
  } catch (e) {
    error(e);
  } finally {
    $('audio-file').value = '';
  }
};
$('audio-clear').onclick = () => {
  delete edit().audio;
  delete edit().credit;
  delete edit().audioText;
  persist();
  updateInputs();
};
$('audio-preview').onclick = () => {
  if (edit().audio) {
    stopSound();
    playback = new Audio(edit().audio);
    playback.play().catch(error);
  } else notice('音声を設定してください');
};
$('record').onclick = async () => {
  try {
    if (recorder?.state === 'recording') {
      recorder.stop();
      return;
    }
    signedIn();
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error('録音にはHTTPSとマイク対応ブラウザが必要です');
    const gen = epoch,
      kana = selected;
    recordStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    guarded(gen);
    const chunks = [];
    const stream = recordStream;
    const recording = new MediaRecorder(stream);
    recorder = recording;
    recording.ondataavailable = (e) => chunks.push(e.data);
    recording.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      if (recorder === recording) $('record').textContent = 'マイクで録音';
      try {
        guarded(gen);
        const blob = new Blob(chunks, { type: recording.mimeType });
        if (blob.size > 5_000_000) throw new Error('録音が長すぎます');
        signedIn();
        const value = (
          await api('/api/upload/audio', {
            method: 'POST',
            raw: blob,
            headers: { 'Content-Type': blob.type },
          })
        ).url;
        guarded(gen);
        draft.edits[kana].audio = value;
        draft.edits[kana].audioText = draft.edits[kana].text;
        persist();
        updateInputs();
      } catch (e) {
        error(e);
      }
    };
    recording.start();
    $('record').textContent = '録音を終了';
    setTimeout(() => {
      if (recording.state === 'recording') recording.stop();
    }, 45000);
  } catch (e) {
    recordStream?.getTracks().forEach((t) => t.stop());
    error(e);
  }
};
const canvas = $('drawing'),
  ctx = canvas.getContext('2d');
let drawing = false;
function clearDrawing() {
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}
clearDrawing();
$('draw-toggle').onclick = () => {
  $('draw-area').hidden = !$('draw-area').hidden;
};
$('draw-clear').onclick = clearDrawing;
function point(e) {
  const r = canvas.getBoundingClientRect();
  return [
    ((e.clientX - r.left) * canvas.width) / r.width,
    ((e.clientY - r.top) * canvas.height) / r.height,
  ];
}
canvas.onpointerdown = (e) => {
  drawing = true;
  canvas.setPointerCapture(e.pointerId);
  ctx.beginPath();
  ctx.moveTo(...point(e));
};
canvas.onpointermove = (e) => {
  if (!drawing) return;
  ctx.strokeStyle = $('pen-color').value;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.lineTo(...point(e));
  ctx.stroke();
};
canvas.onpointerup = canvas.onpointercancel = () => (drawing = false);
$('draw-use').onclick = () => {
  edit().image = canvas.toDataURL('image/png');
  persist();
  updateInputs();
  $('draw-area').hidden = true;
};
$('demo').onclick = () => {
  const examples = [
    ['あ', 'あさの ひかりで きょうも げんき', '☀', '#f3d883'],
    ['い', 'いちごを みんなで いただきます', '🍓', '#f2c3bc'],
    ['う', 'うみの なみが よんでいる', '🌊', '#bedce2'],
    ['え', 'えがおが あつまる たのしい ひ', '☺', '#d3debc'],
    ['お', 'おつきさまに おやすみなさい', '☾', '#cfd1e5'],
  ];
  for (const [kana, text, symbol, color] of examples) {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 450;
    const x = c.getContext('2d');
    x.fillStyle = color;
    x.fillRect(0, 0, 400, 450);
    x.font = '160px sans-serif';
    x.textAlign = 'center';
    x.fillStyle = '#315f4d';
    x.fillText(symbol, 200, 290);
    draft.cards = draft.cards.filter((c) => c.kana !== kana);
    draft.cards.push({ id: kana, kana, text, image: c.toDataURL() });
    delete draft.edits[kana];
  }
  persist();
  updateInputs();
  notice('おためしの札を作りました。ログインして保存・対戦できます');
};
async function listCloud(append = false) {
  signedIn();
  const gen = epoch;
  const b = await api(
    '/api/decks' + (append && libraryCursor ? '?cursor=' + encodeURIComponent(libraryCursor) : ''),
  );
  guarded(gen);
  if (!append) $('cloud-list').replaceChildren();
  libraryCursor = b.nextCursor;
  $('more-cloud').hidden = !libraryCursor;
  for (const d of b.decks) {
    const row = document.createElement('div');
    row.className = 'deck-row';
    const info = document.createElement('div');
    info.className = 'deck-info';
    const title = document.createElement('strong');
    title.textContent = d.title;
    const meta = document.createElement('small');
    meta.textContent = `${d.count}枚 ・ ${new Date(d.updated_at).toLocaleString('ja-JP')} ・ 版${d.revision}`;
    info.append(title, meta);
    const load = document.createElement('button');
    load.className = 'quiet';
    load.textContent = '開く';
    load.onclick = () =>
      act(async () => {
        if (!confirm('現在の編集中の内容を置き換えますか？')) return;
        const gen = epoch,
          snapshot = JSON.stringify(draft),
          saved = await api('/api/decks/' + d.id);
        guarded(gen);
        if (snapshot !== JSON.stringify(draft))
          throw new Error('読込中に編集されたため中止しました');
        epoch++;
        cancelLocal();
        draft = {
          title: saved.title,
          cards: saved.cards,
          edits: {},
          active: { id: saved.id, revision: saved.revision },
        };
        persist();
        renderDraft();
        notice('クラウドから読み込みました');
      });
    const del = document.createElement('button');
    del.className = 'quiet danger';
    del.textContent = '削除';
    del.onclick = () =>
      act(async () => {
        if (!confirm(`「${d.title}」をクラウドから削除しますか？画像と音声はR2に残ります。`))
          return;
        const gen = epoch;
        await api('/api/decks/' + d.id, {
          method: 'DELETE',
          headers: { 'If-Match': String(d.revision) },
        });
        guarded(gen);
        if (draft.active?.id === d.id) {
          draft.active = null;
          persist();
          renderDraft();
        }
        await listCloud();
      });
    row.append(info, load, del);
    $('cloud-list').append(row);
  }
}
async function saveCloud(copy) {
  signedIn();
  const gen = epoch,
    original = draft,
    snapshot = JSON.stringify(draft);
  const list = await committedCards();
  guarded(gen);
  const active = copy ? null : draft.active;
  const saved = await api('/api/decks' + (active ? '/' + active.id : ''), {
    method: active ? 'PUT' : 'POST',
    data: { title: draft.title, cards: list, revision: active?.revision },
  });
  guarded(gen);
  if (draft !== original) throw new Error('別のかるたに切り替わりました');
  const unchanged = snapshot === JSON.stringify(draft);
  draft.active = { id: saved.id, revision: saved.revision };
  if (unchanged) draft.cards = list;
  persist();
  renderDraft();
  notice('クラウドに保存しました');
  await listCloud();
}
$('save-cloud').onclick = () => act(() => saveCloud(false));
$('copy-cloud').onclick = () => act(() => saveCloud(true));
$('refresh-cloud').onclick = () => act(() => listCloud());
$('more-cloud').onclick = () => act(() => listCloud(true));
$('new-deck').onclick = () => {
  if (!confirm('新しいかるたを作りますか？クラウド保存していない内容は置き換わります。')) return;
  epoch++;
  cancelLocal();
  draft = { title: '新しいかるた', cards: [], edits: {}, active: null };
  persist();
  renderDraft();
};
$('export').onclick = () => {
  const blob = new Blob(
    [JSON.stringify({ version: 1, title: draft.title, cards: draft.cards }, null, 2)],
    { type: 'application/json' },
  );
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = 'karuta.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};
$('import').onchange = async (e) => {
  const gen = epoch;
  try {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 15_000_000) throw new Error('JSONが大きすぎます');
    const b = JSON.parse(await f.text());
    guarded(gen);
    if (
      !Array.isArray(b.cards) ||
      b.cards.length > 46 ||
      typeof b.title !== 'string' ||
      b.title.length > 80
    )
      throw new Error('かるたJSONが不正です');
    const seen = new Set();
    for (const c of b.cards) {
      if (
        !KANA.includes(c.kana) ||
        seen.has(c.kana) ||
        typeof c.text !== 'string' ||
        !c.text.trim() ||
        c.text.length > 200 ||
        !(
          /^\/api\/media\/image\/[a-f0-9]{64}$/.test(c.image) ||
          /^data:image\/(png|jpeg|webp);base64,/.test(c.image)
        ) ||
        (c.audio &&
          !(
            /^\/api\/media\/audio\/[a-f0-9]{64}$/.test(c.audio) ||
            /^data:audio\/[a-z0-9.;=+-]+;base64,/i.test(c.audio)
          ))
      )
        throw new Error('札の形式が不正です');
      seen.add(c.kana);
      c.id = c.kana;
    }
    epoch++;
    cancelLocal();
    draft = { title: b.title, cards: b.cards, edits: {}, active: null };
    persist();
    renderDraft();
    notice('JSONを読み込みました');
  } catch (e) {
    error(e);
  } finally {
    e.target.value = '';
  }
};
async function createRoom() {
  signedIn();
  const gen = epoch;
  const list = await committedCards();
  guarded(gen);
  const b = await api('/api/rooms', {
    method: 'POST',
    data: {
      cards: list,
      rules: {
        mode: $('mode').value,
        memorizeSeconds: Math.round(Number($('memorize').value) * 60),
        durationSeconds: Math.round(Number($('duration').value) * 60),
        target: Number($('target').value),
      },
      ttl: Number($('ttl').value),
    },
  });
  guarded(gen);
  $('room-url').value = b.url;
  await joinRoom(b.id);
}
function parseRoom(s) {
  try {
    const u = new URL(s);
    return u.searchParams.get('room');
  } catch {
    return s;
  }
}
async function joinRoom(id) {
  if (!/^[a-f0-9]{64}$/.test(id || '')) throw new Error('招待URLを確認してください');
  if (socket && socket.readyState < 2) throw new Error('既に対戦に参加しています');
  const name = $('player-name').value.trim();
  if (!name) throw new Error('名前を入力してください');
  const b = await api(`/api/rooms/${id}/join`, { method: 'POST', data: { name } });
  playerId = b.playerId;
  roomId = id;
  lastRound = -1;
  const url = new URL(`/api/rooms/${id}/ws`, location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('ticket', b.ticket);
  socket = new WebSocket(url);
  socket.onmessage = (e) => {
    const b = JSON.parse(e.data);
    if (b.type === 'state') renderGame(b);
    else if (b.type === 'miss' || b.type === 'error') $('game-message').textContent = b.message;
  };
  socket.onclose = () => {
    stopSound();
    if (game?.phase !== 'ended')
      $('game-message').textContent =
        '接続が切れました。開始後は再参加できません。開始前なら再参加してください。';
  };
  socket.onerror = () => notice('対戦に接続できません。期限や接続を確認してください');
  $('game').hidden = false;
  $('invite').value = `${location.origin}/?room=${id}`;
  history.replaceState(null, '', `?room=${id}`);
  switchTab(true);
}
$('create-room').onclick = () => act(createRoom);
$('create-room').dataset.lock = '';
$('join-room').onclick = () => act(() => joinRoom(parseRoom($('room-url').value.trim())));
$('join-room').dataset.lock = '';
function send(value) {
  if (socket?.readyState === 1) socket.send(JSON.stringify(value));
}
$('start-game').onclick = () => send({ type: 'start' });
$('end-game').onclick = () => {
  if (confirm('対戦を終了して招待URLと対戦データを削除しますか？')) send({ type: 'end' });
};
$('copy-invite').onclick = () =>
  navigator.clipboard
    .writeText($('invite').value)
    .then(() => notice('招待URLをコピーしました'))
    .catch(error);
function stopSound() {
  speechSynthesis.cancel();
  if (playback) {
    playback.pause();
    playback.src = '';
    playback = null;
  }
  if (playbackUrl) {
    URL.revokeObjectURL(playbackUrl);
    playbackUrl = null;
  }
}
async function readPrompt() {
  stopSound();
  if (!sound || !game?.prompt || game.phase !== 'play') return;
  const prompt = game.prompt,
    round = game.round;
  if (prompt.audio && (!prompt.audioText || prompt.audioText === prompt.text)) {
    playback = new Audio(prompt.audio);
    try {
      await playback.play();
      return;
    } catch {
      if (game.round !== round) return;
      notice('音声再生ができませんでした。端末の読み上げを使います');
    }
  }
  if (game.round !== round || game.phase !== 'play') return;
  const speech = new SpeechSynthesisUtterance(prompt.text);
  speech.lang = 'ja-JP';
  speech.rate = Number($('speech-rate').value);
  speech.voice =
    speechSynthesis.getVoices().find((v) => v.voiceURI === $('speech-voice').value) || null;
  speechSynthesis.speak(speech);
}
$('enable-sound').onclick = () => {
  sound = !sound;
  $('enable-sound').textContent = sound ? '音声をミュート' : '音声を有効にする';
  if (sound) readPrompt();
  else stopSound();
};
$('replay').onclick = readPrompt;
function speechVoices() {
  const select = $('speech-voice'),
    selected = select.value;
  select.replaceChildren(new Option('端末の標準音声', ''));
  for (const v of speechSynthesis.getVoices().filter((v) => /^ja/i.test(v.lang)))
    select.add(new Option(v.name, v.voiceURI));
  select.value = selected;
}
speechSynthesis.onvoiceschanged = speechVoices;
speechVoices();
function renderGame(b) {
  game = b;
  clockSkew = b.serverNow - Date.now();
  const me = b.players.find((p) => p.id === playerId);
  $('game').hidden = false;
  $('start-game').hidden = !(me?.host && b.phase === 'lobby');
  $('end-game').hidden = !(me?.host && b.phase !== 'ended');
  $('invite-row').hidden = b.phase !== 'lobby';
  $('players').replaceChildren();
  for (const p of [...b.players].sort((a, b) => b.score - a.score)) {
    const el = document.createElement('span');
    el.className = 'player' + (p.id === playerId ? ' me' : '');
    el.textContent = `${p.host ? '♛ ' : ''}${p.name}${p.connected ? '' : '（切断）'}`;
    const score = document.createElement('b');
    score.textContent = `${p.score}枚`;
    el.append(score);
    $('players').append(el);
  }
  const titles = {
    lobby: [
      'WAITING ROOM',
      'みんなを待っています',
      '準備はいい？',
      'みんなの準備ができたらスタート',
    ],
    memorize: ['MEMORY TIME', '札の場所を覚えよう', '記憶タイム', '札は対戦中も同じ場所に並びます'],
    play: [
      'LET’S PLAY',
      'ことばを聞いて、札をとろう',
      '読み札',
      b.prompt?.text || '次の読み札を待っています…',
    ],
    ended: [
      'RESULT',
      '対戦が終了しました',
      'おつかれさまでした',
      '招待URLと対戦データは削除されました',
    ],
  };
  const t = titles[b.phase];
  $('game-phase').textContent = t[0];
  $('game-title').textContent = t[1];
  $('prompt-label').textContent = t[2];
  $('prompt-text').textContent = t[3];
  $('replay').hidden = !(b.phase === 'play' && b.prompt);
  $('prompt-credit').textContent = b.prompt?.credit || '';
  const board = $('board');
  if (board.dataset.room !== roomId) {
    board.replaceChildren();
    board.dataset.room = roomId;
    for (const c of b.board) {
      const button = document.createElement('button');
      button.dataset.id = c.id;
      button.setAttribute('aria-label', `${c.kana}の札`);
      const image = document.createElement('img');
      image.src = c.image;
      image.alt = '';
      const label = document.createElement('b');
      label.textContent = c.kana;
      button.append(image, label);
      button.onclick = () => send({ type: 'tap', card: c.id, round: game.round });
      board.append(button);
    }
  }
  for (const button of board.children) {
    button.classList.toggle('taken', b.taken.includes(button.dataset.id));
    button.disabled = b.phase !== 'play' || !b.prompt || b.taken.includes(button.dataset.id);
  }
  if (lastRound !== b.round || !b.prompt) {
    lastRound = b.round;
    stopSound();
    if (b.prompt) readPrompt();
  }
  $('results').hidden = b.phase !== 'ended';
  if (b.phase === 'ended') {
    const max = Math.max(0, ...b.players.map((p) => p.score)),
      winners = b.players.filter((p) => p.score === max);
    const h = document.createElement('h2');
    h.textContent = winners.map((p) => p.name).join(' ＆ ') + (max ? ' の勝ち！' : ' — 引き分け');
    const p = document.createElement('p');
    p.textContent = `最多 ${max}枚${b.reason === 'expired' ? '・有効期限切れ' : ''}`;
    $('results').replaceChildren(h, p);
    stopSound();
  }
}
setInterval(() => {
  if (!game) return;
  const now = Date.now() + clockSkew,
    end = game.phase === 'memorize' ? game.deadline : game.gameEnd || game.expires;
  const seconds = Math.max(0, Math.ceil((end - now) / 1000));
  $('timer').textContent =
    game.phase === 'ended'
      ? '終了'
      : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}, 250);
$('voicevox').onchange = () => {
  const v = voices.find((v) => v.uuid === $('voicevox').value);
  $('voice-terms').replaceChildren();
  if (v) {
    const credit = document.createElement('span');
    credit.textContent = v.credit + ' ';
    const a = document.createElement('a');
    a.href = v.terms;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = '利用規約';
    $('voice-terms').append(credit, a);
  }
};
$('generate-voicevox').onclick = () =>
  act(async () => {
    signedIn();
    const gen = epoch,
      kana = selected,
      text = edit().text;
    const b = await api('/api/voicevox/generate', {
      method: 'POST',
      data: { text, uuid: $('voicevox').value },
    });
    guarded(gen);
    draft.edits[kana].audio = b.url;
    draft.edits[kana].credit = b.credit;
    draft.edits[kana].audioText = text;
    persist();
    updateInputs();
    notice('音声を生成しました。「この札を保存」で反映します');
  });
$('generate-local').onclick = () =>
  act(async () => {
    signedIn();
    const gen = epoch,
      kana = selected,
      text = edit().text;
    if (!text?.trim()) throw new Error('ことばを入力してください');
    $('cancel-local').hidden = false;
    try {
      const { wav, credit } = await generateLocal(
        text,
        (msg) => ($('local-status').textContent = msg),
      );
      guarded(gen);
      const url = (
        await api('/api/upload/audio', {
          method: 'POST',
          raw: new Blob([wav], { type: 'audio/wav' }),
        })
      ).url;
      guarded(gen);
      draft.edits[kana].audio = url;
      draft.edits[kana].audioText = text;
      draft.edits[kana].credit = credit;
      persist();
      updateInputs();
      notice('ブラウザ内で生成した音声をR2に保存しました');
    } finally {
      $('cancel-local').hidden = true;
    }
  });
$('cancel-local').onclick = cancelLocal;
async function authChanged() {
  const id = clerk?.user?.id || null;
  if (id === account) return;
  persist();
  epoch++;
  cancelLocal();
  if (recorder?.state === 'recording') recorder.stop();
  stopSound();
  account = id;
  restore();
  $('cloud-list').replaceChildren();
  $('more-cloud').hidden = true;
  $('login').hidden = !!account;
  $('logout').hidden = !account;
  $('auth-status').textContent = account
    ? clerk.user.firstName || 'ログイン中'
    : 'ログインしてつくろう';
  if (account) listCloud().catch(error);
}
async function init() {
  restore();
  const room = new URLSearchParams(location.search).get('room');
  if (room) {
    switchTab(true);
    $('room-url').value = location.href;
    notice('名前を入力して「対戦に参加する」を押してください');
  }
  try {
    const config = await api('/api/config');
    if (!config.clerkKey) {
      $('auth-status').textContent = '管理者のClerk設定待ち';
      notice('閲覧・おためし編集は可能です。クラウド保存と対戦作成にはClerkの設定が必要です');
    } else {
      const script = document.createElement('script');
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.dataset.clerkPublishableKey = config.clerkKey;
      script.src = `https://${config.clerkDomain}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`;
      await new Promise((resolve, reject) => {
        script.onload = resolve;
        script.onerror = () => reject(new Error('Clerkを読み込めません'));
        document.head.append(script);
      });
      clerk = window.Clerk;
      await clerk.load();
      $('login').onclick = () => clerk.openSignIn();
      $('logout').onclick = () => clerk.signOut();
      $('login').hidden = !!clerk.user;
      $('auth-status').textContent = clerk.user ? 'ログイン中' : 'ログインしてつくろう';
      clerk.addListener(() => authChanged().catch(error));
      await authChanged();
    }
    const v = await api('/api/voicevox/voices');
    voices = v.voices;
    for (const voice of voices) $('voicevox').add(new Option(voice.name, voice.uuid));
    $('generate-voicevox').disabled = !v.ready;
    if (!v.ready) $('voice-terms').textContent = 'VOICEVOXエンジン未設定';
    const local = await api('/api/tts/config');
    $('generate-local').disabled = !local.ready;
    $('local-status').textContent = local.ready
      ? 'WASM音声生成が利用可能です（初回は大容量のダウンロードがあります）'
      : local.message;
  } catch (e) {
    error(e);
    $('auth-status').textContent = '接続・設定を確認してください';
  }
}
window.addEventListener('beforeunload', () => {
  persist();
  stopSound();
});
init();
