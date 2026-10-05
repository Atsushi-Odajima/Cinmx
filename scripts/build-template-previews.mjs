// 同梱テンプレートの表紙（cover.png）と見本動画（preview.mp4）を、アプリと同じ描画エンジン（renderFrame）で生成する。
// フレームは Chromium 内で描画し、H.264 エンコードだけをホストの ffmpeg (libx264) で行う。
// 前提: pnpm --filter @cinemix/web build 済み、ffmpeg あり。実行: pnpm templates:build
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'apps', 'web');
const outRoot = join(web, 'public', 'templates');
const TEMPLATES = [
  { slug: 'quiet-cut', id: '0b6f1d2e-5a3c-4c8e-9d1f-1a2b3c4d5e01', texts: [{ value: '夏の記録', fontId: 'noto-serif-jp', slotIndex: 0, centerY: 0.5 }, { value: 'Quiet Cut', fontId: 'caveat', slotIndex: 2, centerY: 0.8 }] },
  { slug: 'postcard', id: '0b6f1d2e-5a3c-4c8e-9d1f-1a2b3c4d5e02', texts: [{ value: 'Postcard', fontId: 'allura', slotIndex: 0, centerY: 0.88 }, { value: '小さな旅', fontId: 'noto-sans-jp', slotIndex: 3, centerY: 0.88 }], withBackground: true },
  { slug: 'contact-strip', id: '0b6f1d2e-5a3c-4c8e-9d1f-1a2b3c4d5e03', texts: [{ value: 'Contact Strip', fontId: 'noto-sans-jp', slotIndex: 0, centerY: 0.9, color: '#25382E' }] },
];

const port = 4174;
const server = spawn('pnpm', ['exec', 'vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: web, stdio: 'ignore' });
const waitFor = async (url, ms = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('preview server did not start');
};
try {
  await waitFor(`http://127.0.0.1:${port}/`);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => !!window.__cinemix);
  for (const t of TEMPLATES) {
    const dir = join(outRoot, t.slug);
    mkdirSync(dir, { recursive: true });
    const tmp = join(root, '.tmp-frames', t.slug);
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    const opts = { templateId: t.id, texts: t.texts, audio: null, withBackground: !!t.withBackground };
    // 表紙
    const still = await page.evaluate(([o, ms]) => window.__cinemix.renderStillSample(o, ms), [opts, 1200]);
    writeFileSync(join(dir, 'cover.png'), Buffer.from(still.base64, 'base64'));
    // フレーム列 → ffmpeg
    let total = Infinity;
    for (let from = 0; from < total; from += 45) {
      const r = await page.evaluate(([o, a, b]) => window.__cinemix.renderFramesSample(o, a, b, 0.9), [opts, from, from + 45]);
      total = r.total;
      r.frames.forEach((f, i) => writeFileSync(join(tmp, `f${String(from + i).padStart(4, '0')}.jpg`), Buffer.from(f, 'base64')));
      process.stdout.write(`${t.slug}: ${Math.min(from + 45, total)}/${total}\r`);
    }
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', join(tmp, 'f%04d.jpg'), '-c:v', 'libx264', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-crf', '27', '-preset', 'medium', '-movflags', '+faststart', '-an', join(dir, 'preview.mp4')]);
    const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,nb_frames:format=duration,size', '-of', 'csv=p=0', join(dir, 'preview.mp4')], { encoding: 'utf8' });
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ id: t.id, slug: t.slug, generatedAt: new Date().toISOString(), engine: 'renderFrame (same as app) + ffmpeg libx264 (host encode only)', probe: probe.trim() }, null, 2));
    rmSync(tmp, { recursive: true, force: true });
    console.log(`\n${t.slug}: ${probe.trim().replace(/\n/g, ' | ')}`);
  }
  await browser.close();
} finally {
  server.kill();
  rmSync(join(root, '.tmp-frames'), { recursive: true, force: true });
}
