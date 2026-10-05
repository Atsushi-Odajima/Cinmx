// 全画面の UI スクリーンショットを撮る（390×844, 2x）。前提: pnpm --filter @cinemix/web build 済み。
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'apps', 'web');
const out = join(root, 'docs', 'screenshots', 'ui');
mkdirSync(out, { recursive: true });
const SAMPLES = ['sample-01.jpg', 'sample-02.jpg', 'sample-03.jpg', 'sample-04.jpg', 'sample-05.jpg'].map((n) => join(web, 'public', 'samples', n));
const port = 4175;
const server = spawn('pnpm', ['exec', 'vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: web, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
const waitFor = async (url, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if ((await fetch(url)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 300)); } throw new Error('no server'); };
let n = 0;
const shot = async (page, name, full = true) => { n++; const p = join(out, `${String(n).padStart(2, '0')}-${name}.png`); await page.screenshot({ path: p, fullPage: full }); console.log('shot', p); };
try {
  await waitFor(base + '/');
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ja-JP' });
  const page = await ctx.newPage();
  await page.goto(base + '/templates'); await page.waitForLoadState('networkidle'); await page.waitForTimeout(800);
  await shot(page, 'S1-templates');
  await page.getByRole('link', { name: 'このテンプレートを見る' }).click(); await page.waitForTimeout(600);
  await shot(page, 'S2-template-detail');
  await page.getByRole('button', { name: 'このテンプレートを使う' }).click();
  await page.getByText('あと 5 点選んでください').waitFor();
  await shot(page, 'S3-media-empty');
  await page.getByTestId('media-file-input').setInputFiles(SAMPLES.slice(0, 4));
  await page.getByText('あと 1 点選んでください').waitFor(); await page.waitForTimeout(400);
  await shot(page, 'S3-media-4of5');
  await page.getByTestId('media-file-input').setInputFiles(SAMPLES.slice(4, 5));
  await page.getByText('素材がそろいました').waitFor(); await page.waitForTimeout(400);
  await shot(page, 'S3-media-complete');
  await page.getByRole('button', { name: /1 番の枠 （素材あり）/ }).click(); await page.waitForTimeout(300);
  await shot(page, 'S3-slot-sheet', false);
  await page.getByRole('button', { name: '位置と大きさを調整' }).click(); await page.waitForTimeout(800);
  await shot(page, 'S3-crop-sheet', false);
  await page.getByRole('button', { name: '閉じる' }).last().click(); await page.waitForTimeout(200); // クロップシート（最前面）
  await page.getByRole('button', { name: '閉じる' }).last().click(); await page.waitForTimeout(200); // 枠シート
  await page.getByRole('button', { name: '文字と音楽で仕上げる' }).click();
  await page.getByRole('button', { name: '再生' }).waitFor(); await page.waitForTimeout(1200);
  await shot(page, 'S4-edit-initial', false);
  await page.getByRole('button', { name: '文字を追加' }).click();
  const ta = page.getByRole('textbox', { name: /本文/ });
  await ta.fill('夏の記録\nSummer Days'); await ta.blur();
  await page.getByLabel('書体').selectOption('caveat');
  await page.getByRole('button', { name: '色 #D7E583' }).click();
  await page.locator('input[type=range][aria-label="再生位置"]').evaluate((el) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '1485'); // 33ms 刻みの値（約 1.5 秒）
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }); await page.waitForTimeout(800);
  await shot(page, 'S4-edit-text-preview', false);
  await shot(page, 'S4-edit-text-form');
  await page.getByRole('tab', { name: '音楽' }).click();
  await page.getByRole('button', { name: '同梱の試聴用音源を使う' }).click();
  await page.getByText(/使う長さ/).waitFor();
  await page.getByLabel('音源の開始（秒）').fill('2'); await page.getByLabel('音源の終了（秒）').fill('10'); await page.waitForTimeout(300);
  await shot(page, 'S4-edit-audio');
  await page.getByText('保存済み').waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: '動画を書き出す' }).click();
  await page.getByText(/720×1280・30fps/).waitFor(); await page.waitForTimeout(800);
  await shot(page, 'S5-export-idle');
  await page.getByRole('button', { name: '音楽付きで書き出す' }).click();
  await page.waitForTimeout(3000);
  await shot(page, 'S5-export-progress', false);
  await page.getByText('動画ができました').waitFor({ timeout: 120000 }); await page.waitForTimeout(800);
  await shot(page, 'S5-export-done');
  await page.goto(base + '/drafts'); await page.waitForLoadState('networkidle'); await page.waitForTimeout(400);
  await shot(page, 'S6-drafts');
  await page.goto(base + '/creator'); await page.waitForLoadState('networkidle'); await page.waitForTimeout(400);
  await shot(page, 'S7-creator-base');
  await page.getByRole('button', { name: /Postcard/ }).click();
  await page.getByRole('button', { name: '再生' }).waitFor(); await page.waitForTimeout(1500);
  await page.locator('input[type=range]').first().evaluate(() => {});
  await shot(page, 'S7-creator-edit');
  await page.getByRole('button', { name: '枠の数と秒数' }).click(); await page.waitForTimeout(300);
  await shot(page, 'S7-creator-durations', false);
  await page.getByRole('button', { name: '閉じる' }).click();
  await page.goto(base + '/account'); await page.waitForLoadState('networkidle'); await page.waitForTimeout(1500);
  await shot(page, 'S8-account-settings');
  await page.goto(base + '/admin'); await page.waitForTimeout(600);
  await shot(page, 'S9-admin-no-permission');
  await browser.close();
} finally {
  server.kill();
}
