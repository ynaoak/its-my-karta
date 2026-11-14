import app, { KarutaRoom as Base } from '../src/worker.ts';
export default app;
export class KarutaRoom extends Base {
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === '/__inspect')
      return Response.json({
        entries: [...(await this.ctx.storage.list())].map(([key]) => key),
        alarm: await this.ctx.storage.getAlarm(),
      });
    if (path === '/__expiry') {
      const r = await this.ctx.storage.get('room');
      r.expires = Date.now() + 80;
      this.room = r;
      await this.ctx.storage.put('room', r);
      await this.ctx.storage.setAlarm(r.expires);
      return Response.json({ ok: true });
    }
    if (path === '/__time') {
      const r = await this.ctx.storage.get('room');
      r.gameEnd = Date.now() + 80;
      this.room = r;
      await this.ctx.storage.put('room', r);
      await this.ctx.storage.setAlarm(r.gameEnd);
      return Response.json({ ok: true });
    }
    return super.fetch(req);
  }
}
