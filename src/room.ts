import { DurableObject } from 'cloudflare:workers';
import { assert, body, HttpError, json, type Card, type Env, type Rules } from './types';
interface Player {
  id: string;
  name: string;
  score: number;
  host: boolean;
  ticket: string;
  joined: number;
  connected: boolean;
}
interface Room {
  owner: string;
  cards: Card[];
  rules: Rules;
  players: Player[];
  phase: 'lobby' | 'memorize' | 'play' | 'ended';
  created: number;
  expires: number;
  deadline: number;
  gameEnd: number;
  taken: string[];
  current?: string;
  round: number;
  nextAt: number;
  reason?: string;
}
export class KarutaRoom extends DurableObject<Env> {
  private room?: Room;
  private queue: Promise<unknown> = Promise.resolve();
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {});
    return result;
  }
  private async load() {
    if (!this.room) this.room = await this.ctx.storage.get<Room>('room');
    return this.room;
  }
  private async save() {
    await this.ctx.storage.put('room', this.room!);
  }
  private sockets() {
    return this.ctx.getWebSockets();
  }
  private view(r: Room) {
    return {
      phase: r.phase,
      rules: r.rules,
      players: r.players.map(({ id, name, score, host, connected }) => ({
        id,
        name,
        score,
        host,
        connected,
      })),
      board: r.cards.map((c) => ({ id: c.id, kana: c.kana, image: c.image })),
      taken: r.taken,
      round: r.round,
      deadline: r.deadline,
      gameEnd: r.gameEnd,
      expires: r.expires,
      serverNow: Date.now(),
      nextAt: r.nextAt,
      prompt: r.current
        ? ((c) => ({ text: c.text, audio: c.audio, audioText: c.audioText, credit: c.credit }))(
            r.cards.find((c) => c.id === r.current)!,
          )
        : null,
      reason: r.reason,
    };
  }
  private send(ws: WebSocket, v: unknown) {
    try {
      ws.send(JSON.stringify(v));
    } catch {}
  }
  private broadcast() {
    const r = this.room!;
    for (const ws of this.sockets()) this.send(ws, { type: 'state', ...this.view(r) });
  }
  private async schedule() {
    const r = this.room!;
    const times = [r.expires];
    if (r.phase === 'memorize') times.push(r.deadline);
    if (r.phase === 'play') {
      if (r.gameEnd) times.push(r.gameEnd);
      if (r.nextAt) times.push(r.nextAt);
    }
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, Math.min(...times)));
  }
  private choose() {
    const r = this.room!;
    const available = r.cards.filter((c) => !r.taken.includes(c.id));
    if (available.length) {
      r.current = available[crypto.getRandomValues(new Uint32Array(1))[0] % available.length].id;
      r.round++;
    }
    r.nextAt = 0;
  }
  private async finish(reason: string) {
    const r = this.room!;
    r.phase = 'ended';
    r.reason = reason;
    r.current = undefined;
    r.nextAt = 0;
    await this.save();
    this.broadcast();
    for (const ws of this.sockets()) {
      try {
        ws.close(1000, '対戦終了');
      } catch {}
    }
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
  }
  private async advance() {
    const r = await this.load();
    if (!r) return;
    if (r.phase === 'ended') {
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const now = Date.now();
    if (now >= r.expires) {
      await this.finish('expired');
      return;
    }
    if (r.phase === 'memorize' && now >= r.deadline) {
      r.phase = 'play';
      r.gameEnd = r.rules.mode === 'time' ? r.deadline + r.rules.durationSeconds * 1000 : 0;
      this.choose();
    }
    if (r.phase === 'play' && r.gameEnd && now >= r.gameEnd) {
      await this.finish('time');
      return;
    }
    if (r.phase === 'play' && r.nextAt && now >= r.nextAt) this.choose();
  }
  async fetch(req: Request) {
    return this.serial(async () => {
      try {
        const path = new URL(req.url).pathname;
        if (path === '/init') {
          assert(!(await this.load()), '作成済みです', 409);
          const b = await body(req);
          const shuffled = [...b.cards] as Card[];
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }
          this.room = {
            owner: b.owner,
            cards: shuffled,
            rules: b.rules,
            players: [],
            phase: 'lobby',
            created: Date.now(),
            expires: Date.now() + b.ttl * 1000,
            deadline: 0,
            gameEnd: 0,
            taken: [],
            round: 0,
            nextAt: 0,
          };
          await this.save();
          await this.schedule();
          return json({ ok: true });
        }
        await this.advance();
        const r = await this.load();
        assert(r && r.phase !== 'ended', 'この対戦は終了または期限切れです', 410);
        if (path === '/join') {
          assert(r.phase === 'lobby', '対戦開始後は参加できません', 409);
          r.players = r.players.filter(
            (p) => p.connected || p.host || Date.now() - p.joined < 60000,
          );
          const b = await body(req);
          assert(
            typeof b.name === 'string' && b.name.trim().length >= 1 && b.name.trim().length <= 20,
            '名前は1〜20文字です',
          );
          const host = b.user === r.owner;
          let p = host ? r.players.find((x) => x.host) : undefined;
          if (!p) {
            assert(r.players.length < 12, '参加者は12人までです', 409);
            p = {
              id: crypto.randomUUID(),
              name: b.name.trim(),
              score: 0,
              host,
              ticket: crypto.randomUUID(),
              joined: Date.now(),
              connected: false,
            };
            r.players.push(p);
          } else {
            assert(!p.connected, '主催者は既に接続しています', 409);
            p.ticket = crypto.randomUUID();
            p.name = b.name.trim();
          }
          await this.save();
          this.broadcast();
          return json({ ticket: p.ticket, playerId: p.id });
        }
        if (path === '/ws') {
          assert(
            req.headers.get('Upgrade')?.toLowerCase() === 'websocket',
            'WebSocketが必要です',
            426,
          );
          const ticket = new URL(req.url).searchParams.get('ticket');
          const p = r.players.find((x) => x.ticket === ticket);
          assert(p, '参加情報が無効です', 403);
          assert(r.phase === 'lobby' && !p.connected, '接続できません', 409);
          p.connected = true;
          p.ticket = '';
          const pair = new WebSocketPair();
          this.ctx.acceptWebSocket(pair[1]);
          pair[1].serializeAttachment({ playerId: p.id, lastTap: 0 });
          await this.save();
          this.broadcast();
          return new Response(null, { status: 101, webSocket: pair[0] });
        }
        return json({ error: 'Not found' }, 404);
      } catch (e) {
        if (e instanceof HttpError) return json({ error: e.message }, e.status);
        console.error(e);
        return json({ error: '対戦サーバーでエラーが発生しました' }, 500);
      }
    });
  }
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    await this.serial(async () => {
      try {
        await this.advance();
        const r = await this.load();
        if (!r || r.phase === 'ended') return;
        assert(typeof message === 'string' && message.length < 1024, 'メッセージが不正です');
        let b: any;
        try {
          b = JSON.parse(message);
        } catch {
          throw new HttpError(400, 'JSONが不正です');
        }
        const attachment = ws.deserializeAttachment();
        const p = r.players.find((x) => x.id === attachment?.playerId);
        assert(p, '参加情報がありません', 403);
        if (b.type === 'start') {
          assert(p.host && r.phase === 'lobby', '開始できません', 403);
          assert(
            r.players.some((x) => x.host && x.connected),
            '主催者が未接続です',
          );
          r.phase = 'memorize';
          r.deadline = Date.now() + r.rules.memorizeSeconds * 1000;
          await this.advance();
        } else if (b.type === 'end') {
          assert(p.host, '主催者のみ終了できます', 403);
          await this.finish('host');
          return;
        } else if (b.type === 'tap') {
          assert(
            r.phase === 'play' && r.current && b.round === r.round,
            '次の読み札を待ってください',
            409,
          );
          const now = Date.now();
          assert(now - (attachment.lastTap || 0) >= 200, '少し待ってタップしてください', 429);
          attachment.lastTap = now;
          ws.serializeAttachment(attachment);
          if (b.card !== r.current) {
            this.send(ws, { type: 'miss', message: 'お手つき！' });
            return;
          }
          r.taken.push(r.current);
          p.score++;
          r.current = undefined;
          r.nextAt = now + 1500;
          if (r.taken.length === r.cards.length) {
            await this.finish('all');
            return;
          }
          if (r.rules.mode === 'target' && p.score >= r.rules.target) {
            await this.finish('target');
            return;
          }
        } else {
          assert(b.type === 'ping', '操作が不正です');
          this.send(ws, { type: 'pong' });
          return;
        }
        await this.save();
        await this.schedule();
        this.broadcast();
      } catch (e) {
        this.send(ws, {
          type: 'error',
          message: e instanceof HttpError ? e.message : '操作に失敗しました',
        });
      }
    });
  }
  async webSocketClose(ws: WebSocket) {
    await this.serial(async () => {
      const r = await this.load();
      if (!r || r.phase === 'ended') return;
      const p = r.players.find((x) => x.id === ws.deserializeAttachment()?.playerId);
      if (p) {
        p.connected = false;
        /* Lobby seats can be reclaimed; active scores stay. */ if (r.phase === 'lobby' && !p.host)
          r.players = r.players.filter((x) => x !== p);
        await this.save();
        this.broadcast();
      }
    });
  }
  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }
  async alarm() {
    await this.serial(async () => {
      await this.advance();
      if (this.room && this.room.phase !== 'ended') {
        await this.save();
        await this.schedule();
        this.broadcast();
      }
    });
  }
}
