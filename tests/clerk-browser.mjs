import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { setup } from './harness.mjs';
import { installClerkFixture } from './clerk-fixture.mjs';
const { mf, tokens } = await setup();
let browser;
try {
  const base = (await mf.ready).origin;
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : chromium.executablePath()),
    args: ['--no-sandbox'],
  });
  const errors = [];
  async function page(options) {
    const context = await browser.newContext();
    const p = await context.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    const requested = await installClerkFixture(p, tokens.user_host, options);
    await p.route('https://fonts.googleapis.com/**', (r) => r.abort());
    await p.goto(base);
    return { p, requested };
  }
  const { p, requested } = await page();
  await p.locator('#login').waitFor({ state: 'visible' });
  assert.equal(await p.evaluate(() => window.__testClerkInitialized), true);
  assert.deepEqual(
    requested.sort(),
    [
      '/npm/@clerk/clerk-js@6.43.1/dist/clerk.browser.js',
      '/npm/@clerk/ui@1.42.6/dist/ui.browser.js',
    ].sort(),
  );
  assert.ok((await p.locator('script[data-clerk-publishable-key]').count()) === 2);
  await p.locator('#login').click();
  await p.getByText('テスト利用者', { exact: true }).waitFor();
  await p.locator('#logout').click();
  await p.locator('#login').waitFor({ state: 'visible' });
  for (const fail of ['sdk', 'ui']) {
    const { p } = await page({ fail });
    await p.locator('#notice').filter({ hasText: 'ログイン画面を読み込めません' }).waitFor();
    assert.equal(await p.locator('#login').isVisible(), false);
    await p.locator('#card-text').fill('認証の読み込みに失敗しても編集できる');
  }
  const { p: missing } = await page({ missingUI: true });
  await missing.locator('#notice').filter({ hasText: '初期化に失敗' }).waitFor();
  assert.equal(await missing.locator('#login').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log(
    'PASS Clerk v6 browser regression: current SDK + UI, explicit UI initialization, sign-in/sign-out, SDK/UI network failures, missing UI global',
  );
} finally {
  await browser?.close();
  await mf.dispose();
}
