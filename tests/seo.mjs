import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { setup } from './harness.mjs';
const { mf } = await setup();
const site = 'https://yondetotte.oshi-katsu.com';
let browser;
try {
  const response = await mf.dispatchFetch(site + '/');
  assert.equal(response.status, 200);
  assert.ok(!response.headers.get('X-Robots-Tag')?.includes('noindex'));
  const html = await response.text();
  assert.match(html, /オリジナルかるた作成・オンライン対戦/);
  const robots = await mf.dispatchFetch(site + '/robots.txt');
  assert.match(robots.headers.get('Content-Type'), /text\/plain/);
  assert.match(await robots.text(), /Sitemap: https:\/\/yondetotte\.oshi-katsu\.com\/sitemap.xml/);
  const sitemap = await mf.dispatchFetch(site + '/sitemap.xml');
  assert.equal(sitemap.status, 200);
  assert.match(sitemap.headers.get('Content-Type'), /application\/xml/);
  const xml = await sitemap.text();
  assert.deepEqual(
    [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((x) => x[1]),
    [site + '/'],
  );
  for (const query of ['?room=' + 'a'.repeat(64), '?utm_source=test&room=' + 'a'.repeat(64)]) {
    const r = await mf.dispatchFetch(site + '/' + query);
    assert.match(r.headers.get('X-Robots-Tag'), /noindex/);
    assert.equal(r.headers.get('Cache-Control'), 'no-store');
    assert.match(await r.text(), /name="robots" content="noindex, nofollow"/);
    const head = await mf.dispatchFetch(site + '/' + query, { method: 'HEAD' });
    assert.match(head.headers.get('X-Robots-Tag'), /noindex/);
  }
  const preview = await mf.dispatchFetch('https://preview.example.workers.dev/');
  assert.match(preview.headers.get('X-Robots-Tag'), /noindex/);
  assert.match(await preview.text(), /name="robots" content="noindex, nofollow"/);
  const previewRobots = await mf.dispatchFetch('https://preview.example.workers.dev/robots.txt');
  assert.match(await previewRobots.text(), /Disallow: \/\n/);
  const redirected = await mf.dispatchFetch(site + '/index.html?room=example', {
    redirect: 'manual',
  });
  assert.equal(redirected.status, 308);
  assert.equal(redirected.headers.get('Location'), site + '/?room=example');
  const api = await mf.dispatchFetch(site + '/api/config');
  assert.match(api.headers.get('X-Robots-Tag'), /noindex/);
  assert.equal((await mf.dispatchFetch(site + '/does-not-exist')).status, 404);
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : chromium.executablePath()),
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const origin = (await mf.ready).origin;
  await page.route('**/*', (r) =>
    new URL(r.request().url()).origin === origin ? r.continue() : r.abort(),
  );
  await page.route('**/api/config', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ clerkKey: null }) }),
  );
  await page.goto(origin);
  const metadata = await page.evaluate((xml) => {
    const parsed = new DOMParser().parseFromString(xml, 'application/xml');
    return {
      title: document.title,
      description: document.querySelector('meta[name="description"]').content,
      canonical: document.querySelector('link[rel="canonical"]').href,
      robots: document.querySelector('meta[name="robots"]').content,
      og: document.querySelector('meta[property="og:image"]').content,
      card: document.querySelector('meta[name="twitter:card"]').content,
      structured: JSON.parse(
        document.querySelector('script[type="application/ld+json"]').textContent,
      ),
      headings: document.querySelectorAll('h1').length,
      xmlErrors: parsed.querySelectorAll('parsererror').length,
    };
  }, xml);
  assert.match(metadata.title, /オリジナルかるた/);
  assert.ok(metadata.description.length >= 60);
  assert.equal(metadata.canonical, site + '/');
  assert.equal(metadata.og, site + '/og-image.png');
  assert.equal(metadata.card, 'summary_large_image');
  assert.equal(metadata.headings, 1);
  assert.equal(metadata.xmlErrors, 0);
  assert.equal(metadata.structured['@context'], 'https://schema.org');
  assert.deepEqual(
    metadata.structured['@graph'].map((x) => x['@type']),
    ['WebSite', 'WebApplication'],
  );
  assert.equal(await page.locator('#faq details').count(), 5);
  await page.locator('#faq summary').first().click();
  assert.equal(await page.locator('#faq details').first().getAttribute('open'), '');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const nojs = await browser.newContext({ javaScriptEnabled: false });
  const staticPage = await nojs.newPage();
  await staticPage.route('**/*', (r) =>
    new URL(r.request().url()).origin === origin ? r.continue() : r.abort(),
  );
  await staticPage.goto(origin);
  assert.ok(await staticPage.locator('#about').innerText());
  assert.equal(await staticPage.locator('link[rel="canonical"]').getAttribute('href'), site + '/');
  const png = await readFile('public/og-image.png');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  const icon = await readFile('public/apple-touch-icon.png');
  assert.equal(icon.readUInt32BE(16), 180);
  assert.equal(icon.readUInt32BE(20), 180);
  console.log(
    'PASS SEO: sitemap XML, robots, canonical, metadata, structured data, no-JS content, mobile FAQ, OGP sizes, invite/preview noindex, preserved invite redirect, API exclusion and 404',
  );
} finally {
  await browser?.close();
  await mf.dispose();
}
