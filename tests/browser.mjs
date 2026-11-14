import { installClerkFixture } from './clerk-fixture.mjs';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { setup } from './harness.mjs';
const { mf, tokens } = await setup();
let browser;
let checks = 0;
try {
  const base = (await mf.ready).origin;
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : chromium.executablePath()),
    headless: true,
    args: ['--no-sandbox'],
  });
  const errors = [];
  async function page() {
    const context = await browser.newContext();
    const p = await context.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (d) => d.accept());
    await installClerkFixture(p, tokens.user_host);
    await p.route('https://fonts.googleapis.com/**', (r) => r.abort());
    return p;
  }
  const host = await page();
  await host.goto(base);
  await host.locator('#login').waitFor({ state: 'visible' });
  await host.locator('#card-text').fill('ゲストの途中入力');
  await host.locator('#login').click();
  await host.getByText('テスト利用者', { exact: true }).waitFor();
  assert.equal(await host.locator('#card-text').inputValue(), '');
  checks++;
  await host.locator('#demo').click();
  await host.locator('#deck-title').fill('ブラウザ保存かるた');
  await host.locator('#save-cloud').click();
  await host.locator('#active-deck').filter({ hasText: '版 1' }).waitFor();
  assert.equal(await host.locator('.deck-row').count(), 1);
  checks++;
  const other = await page();
  await other.goto(base);
  await other.locator('#login').click();
  await other.locator('.deck-row button').filter({ hasText: '開く' }).click();
  await other.locator('#card-count').filter({ hasText: '5 / 46' }).waitFor();
  await other.locator('#deck-title').fill('別の画面から更新');
  await other.locator('#save-cloud').click();
  await other.locator('#active-deck').filter({ hasText: '版 2' }).waitFor();
  checks++;
  await host.locator('#deck-title').fill('競合でも保持する編集');
  await host.locator('#save-cloud').click();
  await host.locator('#notice').filter({ hasText: '他の画面で更新' }).waitFor();
  assert.equal(await host.locator('#deck-title').inputValue(), '競合でも保持する編集');
  await host.locator('#copy-cloud').click();
  await host.locator('#notice').filter({ hasText: 'クラウドに保存しました' }).waitFor();
  checks++;
  await host.locator('#play-tab').click();
  await host.locator('#player-name').fill('主催者');
  await host.locator('#memorize').fill('0');
  await host.locator('#mode').selectOption('target');
  await host.locator('#target').fill('1');
  await host.locator('#create-room').click();
  await host.locator('#start-game').waitFor({ state: 'visible' });
  const invite = await host.locator('#invite').inputValue();
  checks++;
  const guest = await page();
  await guest.goto(base + '/?room=' + new URL(invite).searchParams.get('room'));
  await guest.locator('.hero').waitFor({ state: 'hidden' });
  await guest.locator('#player-name').fill('ゲスト');
  await guest.locator('#join-room').click();
  await guest.locator('#players').getByText('ゲスト', { exact: false }).waitFor();
  await host.locator('#start-game').click();
  await host.locator('#game-phase').filter({ hasText: 'LET’S PLAY' }).waitFor();
  const text = await host.locator('#prompt-text').innerText();
  const kana = {
    'あさの ひかりで きょうも げんき': 'あ',
    'いちごを みんなで いただきます': 'い',
    'うみの なみが よんでいる': 'う',
    'えがおが あつまる たのしい ひ': 'え',
    'おつきさまに おやすみなさい': 'お',
  }[text];
  assert.ok(kana);
  await guest.getByRole('button', { name: kana + 'の札', exact: true }).click();
  await host.locator('#results').waitFor({ state: 'visible' });
  assert.match(await host.locator('#results').innerText(), /ゲスト の勝ち/);
  checks++;
  await host.locator('#editor-tab').click();
  await host.locator('#logout').click();
  await host.locator('#card-text').filter({}).waitFor();
  assert.equal(await host.locator('#card-text').inputValue(), 'ゲストの途中入力');
  checks++;
  await host.setViewportSize({ width: 390, height: 844 });
  await mkdir('.cache/evidence', { recursive: true });
  await host.screenshot({ path: '.cache/evidence/mobile.png', fullPage: true });
  assert.ok(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await host.setViewportSize({ width: 1440, height: 1000 });
  await host.screenshot({ path: '.cache/evidence/desktop.png', fullPage: true });
  checks++;
  assert.deepEqual(errors, []);
  console.log(
    `PASS ${checks} browser groups: account-private drafts, cloud restore, revision conflict, two-browser game, guest capture, responsive layout`,
  );
} finally {
  await browser?.close();
  await mf.dispose();
}
