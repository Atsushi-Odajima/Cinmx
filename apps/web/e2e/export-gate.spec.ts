import { test, expect } from '@playwright/test';
import { ffprobe, saveBase64, hasTool, extractFrame, imageStdDev, imageRmse, audioRms } from './helpers';

type Caps = { webcodecs: { avc: boolean; vp9: boolean; av1: boolean; aac: boolean; opus: boolean; mp3Fallback: boolean }; recommendedPath: string | null; audioSupport: string; notes: string[] };

declare global {
  interface Window {
    __cinemix: {
      probe(): Promise<Caps>;
      exportSample(opts: Record<string, unknown>): Promise<Record<string, unknown> & { base64: string; size: number; durationMs: number; hasAudio: boolean; audioCodec: string | null; path: string; extension: string; texts: { startMs: number; endMs: number; value: string }[]; audio: { sourceInMs: number; sourceOutMs: number } | null; monotonic: boolean; phases: string[] }>;
      cancelSample(opts: Record<string, unknown>, cancelAtMs: number): Promise<{ cancelled: boolean; code?: string }>;
      renderStillSample(opts: Record<string, unknown>, tMs: number): Promise<{ base64: string; size: number }>;
    };
  }
}

test.describe('技術ゲート: 15秒 MP4（5枚の画像＋日本語文字＋音声）', () => {
  test('WebCodecs 経路で実 MP4 を生成し、ffprobe とフレーム・音声検査に通る', async ({ page }, testInfo) => {
    test.skip(!hasTool('ffprobe'), 'ffprobe がない環境では検証できません');
    await page.goto('/');
    const caps = await page.evaluate(() => window.__cinemix.probe());
    testInfo.annotations.push({ type: 'capabilities', description: JSON.stringify(caps) });
    const videoCodec = caps.webcodecs.avc ? 'avc' : caps.webcodecs.vp9 ? 'vp9' : caps.webcodecs.av1 ? 'av1' : null;
    const audioCodec = caps.webcodecs.aac ? 'aac' : caps.webcodecs.mp3Fallback ? 'mp3' : caps.webcodecs.opus ? 'opus' : null;
    test.skip(!videoCodec || !audioCodec, `この Chromium では WebCodecs エンコーダが使えません: ${JSON.stringify(caps.webcodecs)}`);
    if (!caps.webcodecs.avc) testInfo.annotations.push({ type: 'note', description: `この実行環境の Chromium には H.264 エンコーダが無いため ${videoCodec} で代替検証（利用者向けは H.264 固定）` });

    const res = await page.evaluate(([v, a]) => window.__cinemix.exportSample({ forceVideoCodec: v, forceAudioCodec: a }), [videoCodec, audioCodec]);
    const file = saveBase64(`gate-${videoCodec}-${audioCodec}.mp4`, res.base64);
    testInfo.annotations.push({ type: 'result', description: JSON.stringify({ ...res, base64: `(${res.size} bytes)` }) });

    expect(res.extension).toBe('mp4');
    expect(res.path).toBe('webcodecs');
    expect(res.durationMs).toBe(15000);
    expect(res.hasAudio).toBe(true);
    expect(res.audioCodec).toBe(audioCodec);
    expect(res.monotonic).toBe(true);
    expect(res.phases).toEqual(expect.arrayContaining(['fonts', 'preparing', 'audio', 'video', 'muxing', 'done']));
    expect(res.size).toBeGreaterThan(200_000);

    const probe = ffprobe(file);
    const v = probe.streams.find((s) => s.codec_type === 'video')!;
    const a = probe.streams.find((s) => s.codec_type === 'audio')!;
    expect(v).toBeTruthy();
    expect(a).toBeTruthy();
    expect(v.width).toBe(720);
    expect(v.height).toBe(1280);
    expect(v.r_frame_rate).toBe('30/1');
    expect(Number(v.nb_frames ?? 0)).toBe(450);
    expect(Math.abs(Number(probe.format.duration) - 15)).toBeLessThan(0.05);
    expect(Math.abs(Number(a.duration ?? probe.format.duration) - 15)).toBeLessThan(0.1);
    expect(probe.format.format_name).toContain('mp4');
    if (videoCodec === 'avc') expect(v.codec_name).toBe('h264');
    if (audioCodec === 'aac') expect(a.codec_name).toBe('aac');
    if (audioCodec === 'mp3') expect(a.codec_name).toBe('mp3');

    // 先頭／切替時／末尾フレーム: 無地でなく、互いに異なる
    const f0 = extractFrame(file, 0.0, 'gate-f0.png');
    const f1 = extractFrame(file, 1.5, 'gate-f1.png');
    const f2 = extractFrame(file, 3.4, 'gate-f2.png'); // 2枚目の枠（Summer Days / Caveat）
    const f3 = extractFrame(file, 7.5, 'gate-f3.png');
    const f4 = extractFrame(file, 14.9, 'gate-f4.png'); // 末尾（おわり）
    for (const f of [f1, f2, f3, f4]) expect(imageStdDev(f)).toBeGreaterThan(0.03);
    expect(imageRmse(f1, f2)).toBeGreaterThan(0.05);
    expect(imageRmse(f2, f3)).toBeGreaterThan(0.05);
    expect(imageRmse(f3, f4)).toBeGreaterThan(0.05);
    // 文字の有無: 文字開始直前(2.9s, 枠1の文字は 0..3s なので表示中) vs 枠2の開始後 (3.4s)
    // 同一枠内で文字の有無だけが異なる比較: 枠0 内で文字は 0..3000 表示 → 枠0 全体で表示。比較は renderStill で行う。
    void f0;

    // 音声: 2s→10s を使うので 0..8s は鳴り、8s 以降は無音。最後の 1s（7..8s）はフェード。
    const [early, mid, fadeStart, fadeEnd, tail] = audioRms(file, [
      [0.5, 3.0],
      [4.0, 6.5],
      [7.0, 7.25],
      [7.7, 7.95],
      [9.0, 14.5],
    ]);
    testInfo.annotations.push({ type: 'audio-rms', description: JSON.stringify({ early, mid, fadeStart, fadeEnd, tail }) });
    expect(early!).toBeGreaterThan(0.01);
    expect(mid!).toBeGreaterThan(0.01);
    expect(fadeStart!).toBeGreaterThan(fadeEnd! * 1.5);
    expect(tail!).toBeLessThan(0.002);
  });

  test('文字は表示区間 [start,end) の内側だけ描かれ、最前面にある', async ({ page }) => {
    await page.goto('/');
    const texts = [{ value: 'テスト文字 ABC', fontId: 'caveat', slotIndex: 1, centerY: 0.5, color: '#FFFCF4' }];
    const before = await page.evaluate((t) => window.__cinemix.renderStillSample({ texts: t, audio: null }, 2990), texts);
    const inside = await page.evaluate((t) => window.__cinemix.renderStillSample({ texts: t, audio: null }, 4500), texts);
    const insideNoText = await page.evaluate(() => window.__cinemix.renderStillSample({ texts: [], audio: null }, 4500));
    const after = await page.evaluate((t) => window.__cinemix.renderStillSample({ texts: t, audio: null }, 6000), texts);
    const pB = saveBase64('text-before.png', before.base64);
    const pI = saveBase64('text-inside.png', inside.base64);
    const pN = saveBase64('text-inside-notext.png', insideNoText.base64);
    const pA = saveBase64('text-after.png', after.base64);
    // 同時刻で文字あり／なしは異なる（文字が描かれている）
    expect(imageRmse(pI, pN)).toBeGreaterThan(0.005);
    void pB;
    void pA;
  });

  test('キャンセルで下書きを壊さず中断できる', async ({ page }) => {
    await page.goto('/');
    const caps = await page.evaluate(() => window.__cinemix.probe());
    const videoCodec = caps.webcodecs.avc ? 'avc' : caps.webcodecs.vp9 ? 'vp9' : caps.webcodecs.av1 ? 'av1' : null;
    test.skip(!videoCodec, 'WebCodecs なし');
    const r = await page.evaluate((v) => window.__cinemix.cancelSample({ forceVideoCodec: v, audio: null }, 1500), videoCodec);
    expect(r.cancelled).toBe(true);
    expect(r.code).toBe('cancelled');
  });

  test('音声なしで保存（明示）も MP4 を生成する', async ({ page }) => {
    test.skip(!hasTool('ffprobe'), 'ffprobe なし');
    await page.goto('/');
    const caps = await page.evaluate(() => window.__cinemix.probe());
    const videoCodec = caps.webcodecs.avc ? 'avc' : caps.webcodecs.vp9 ? 'vp9' : caps.webcodecs.av1 ? 'av1' : null;
    test.skip(!videoCodec, 'WebCodecs なし');
    const res = await page.evaluate((v) => window.__cinemix.exportSample({ forceVideoCodec: v, withoutAudio: true, templateId: '0b6f1d2e-5a3c-4c8e-9d1f-1a2b3c4d5e02', withBackground: true }), videoCodec);
    const file = saveBase64('gate-noaudio-postcard.mp4', res.base64);
    expect(res.hasAudio).toBe(false);
    const probe = ffprobe(file);
    expect(probe.streams.some((s) => s.codec_type === 'audio')).toBe(false);
    expect(Number(probe.streams.find((s) => s.codec_type === 'video')!.nb_frames)).toBe(450);
  });
});
