// ブランド素材を自作 SVG / HTML から PNG に書き出す（Chromium で描画）。壊れた画像パスを残さないため、ビルド前に実行する。
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'apps', 'web');
const brandDir = join(web, 'public', 'brand');
const fontsCss = readFileSync(join(web, 'public', 'fonts', 'fonts.css'), 'utf8').replaceAll('url(/fonts/', `url(file://${join(web, 'public', 'fonts')}/`);
mkdirSync(brandDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function renderSvg(svgFile, outFile, size) {
  const svg = readFileSync(join(brandDir, svgFile), 'utf8');
  await page.setViewportSize({ width: size.w, height: size.h });
  await page.setContent(`<!doctype html><html><head><style>${fontsCss} html,body{margin:0;background:transparent} svg{display:block;width:${size.w}px;height:${size.h}px}</style></head><body>${svg}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(brandDir, outFile), omitBackground: true, clip: { x: 0, y: 0, width: size.w, height: size.h } });
  console.log('wrote', outFile);
}

await renderSvg('logo-mark.svg', 'pwa-icon-512.png', { w: 512, h: 512 });
await renderSvg('logo-mark.svg', 'pwa-icon-192.png', { w: 192, h: 192 });
await renderSvg('logo-mark.svg', 'apple-touch-icon.png', { w: 180, h: 180 });
await renderSvg('logo-mark.svg', 'logo-mark.png', { w: 256, h: 256 });
await renderSvg('logo-horizontal.svg', 'logo-horizontal.png', { w: 1200, h: 320 });

// ブランドボード（ポスター型）: 実装済み画面のスクリーンショットがあれば埋め込む
const shots = ['templates', 'edit', 'export'].map((n) => join(root, 'docs', 'screenshots', `${n}-390.png`)).filter((p) => existsSync(p));
const shotTags = shots.map((p) => `<img src="file://${p}" alt="">`).join('');
const cover = join(web, 'public', 'templates', 'quiet-cut', 'cover.png');
const coverTag = existsSync(cover) ? `<img class="cover" src="file://${cover}" alt="">` : `<div class="cover ph"></div>`;
const board = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
${fontsCss}
html,body{margin:0}
body{width:1600px;height:1000px;background:#F3F0E7;color:#25382E;font-family:'Noto Sans JP',sans-serif;position:relative;overflow:hidden}
.big{position:absolute;left:72px;top:64px;font-family:'Bodoni Moda',serif;font-size:168px;font-weight:600;letter-spacing:-0.02em;line-height:1}
.big b{font-weight:700}
.tag{position:absolute;left:76px;top:270px;font-family:'Noto Serif JP',serif;font-size:40px;font-weight:600;letter-spacing:-0.01em}
.sub{position:absolute;left:76px;top:330px;font-size:20px;color:#59665D}
.rule{position:absolute;left:72px;top:400px;width:640px;height:1px;background:#C8CDC2}
.spec{position:absolute;left:76px;top:420px;font-size:14px;line-height:1.7;color:#59665D;width:620px;font-variant-numeric:tabular-nums}
.spec b{color:#25382E}
.cover{position:absolute;left:760px;top:64px;width:405px;height:720px;object-fit:cover;border-radius:4px;background:#25382E}
.ph{background:linear-gradient(160deg,#59665D,#25382E)}
.swatches{position:absolute;left:1200px;top:64px;display:grid;grid-template-columns:1fr 1fr;gap:12px;width:330px}
.sw{height:84px;border-radius:4px;border:1px solid #C8CDC2;position:relative;font-size:12px;padding:8px;box-sizing:border-box}
.sw span{position:absolute;left:8px;bottom:6px;font-family:ui-monospace,monospace}
.type{position:absolute;left:1200px;top:430px;width:330px}
.type .a{font-family:'Bodoni Moda',serif;font-size:44px;font-weight:600;line-height:1.1}
.type .b{font-family:'Noto Serif JP',serif;font-size:22px;font-weight:600;margin-top:10px}
.type .c{font-size:16px;line-height:1.6;margin-top:8px}
.type .d{font-family:'Caveat',cursive;font-size:30px;margin-top:8px;color:#59665D}
.type .e{font-size:13px;letter-spacing:0.01em;color:#59665D;margin-top:8px}
.shots{position:absolute;left:72px;top:600px;display:flex;gap:16px}
.shots img{height:360px;width:auto;border:1px solid #C8CDC2;border-radius:4px;background:#fff}
.mark{position:absolute;right:72px;bottom:56px;width:96px;height:96px}
.foot{position:absolute;left:76px;bottom:40px;font-size:12px;color:#59665D}
</style></head><body>
<div class="big">Cinemi<b>X</b></div>
<div class="tag">写真を選んで、見本のような動画に。</div>
<div class="sub">テンプレートを選ぶ。素材を並べる。文字と音楽で仕上げる。</div>
<div class="rule"></div>
<div class="spec"><b>縦 9:16 · 720×1280 · 30fps · 最大 30 秒</b><br>完成見本がそのまま選択肢。固定されたコマ割り・表示時間・フレーム・フェード・移動・ズームに、自分の写真と動画を当てはめる。<br>文字は最前面。音楽は 1 曲。素材は端末内で処理。</div>
${coverTag}
<div class="swatches">
<div class="sw" style="background:#F3F0E7">page<span>#F3F0E7</span></div>
<div class="sw" style="background:#FFFCF4">surface<span>#FFFCF4</span></div>
<div class="sw" style="background:#25382E;color:#FFFCF4">ink<span>#25382E</span></div>
<div class="sw" style="background:#59665D;color:#FFFCF4">muted<span>#59665D</span></div>
<div class="sw" style="background:#D7E583">accent<span>#D7E583</span></div>
<div class="sw" style="background:#E2E8D7">selected<span>#E2E8D7</span></div>
</div>
<div class="type"><div class="a">Film Contact</div><div class="b">見出し · Noto Serif JP</div><div class="c">本文 16px · Noto Sans JP · 行間 1.6。番号と時刻は tabular-nums 0.0 秒。</div><div class="d">Summer Days — Caveat</div><div class="e">補助 13px / 0.01em</div></div>
<div class="shots">${shotTags}</div>
<svg class="mark" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#25382E"/><rect x="236" y="104" width="172" height="304" rx="10" fill="#FFFCF4"/><rect x="256" y="124" width="132" height="200" rx="4" fill="#D7E583"/><rect x="256" y="340" width="76" height="12" rx="3" fill="#C8CDC2"/><path d="M 262 176 A 118 118 0 1 0 262 336" fill="none" stroke="#FFFCF4" stroke-width="48" stroke-linecap="round"/></svg>
<div class="foot">CinemiX brand board — 自作ワードマークとマーク。人物写真・抽象 3D なし。生成日 ${new Date().toISOString().slice(0, 10)}${shots.length ? '' : '（画面スクリーンショット未取得のため見本枠は空）'}</div>
</body></html>`;
await page.setViewportSize({ width: 1600, height: 1000 });
await page.setContent(board);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
await page.screenshot({ path: join(brandDir, 'brand-board.png'), clip: { x: 0, y: 0, width: 1600, height: 1000 } });
console.log('wrote brand-board.png', shots.length ? `(with ${shots.length} screenshots)` : '(no screenshots yet)');
await browser.close();
