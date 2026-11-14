import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ||
    (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : chromium.executablePath()),
  args: ['--no-sandbox'],
});
try {
  for (const [source, output, width, height] of [
    ['public/og-image.svg', 'public/og-image.png', 1200, 630],
    ['public/favicon.svg', 'public/apple-touch-icon.png', 180, 180],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const svg = await readFile(source, 'utf8');
    await page.setContent(
      `<html><head><style>html,body{margin:0;width:100%;height:100%}svg{display:block;width:100%;height:100%}</style></head><body>${svg}</body></html>`,
    );
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: output, omitBackground: true });
    await page.close();
    console.log(`Rendered ${output}: ${width}x${height}`);
  }
} finally {
  await browser.close();
}
