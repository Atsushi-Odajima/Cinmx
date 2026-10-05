import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

const SAMPLES = ['sample-01.jpg', 'sample-02.jpg', 'sample-03.jpg', 'sample-04.jpg', 'sample-05.jpg'].map((n) => join(process.cwd(), 'public', 'samples', n));
const SHOTS = join(process.cwd(), '..', '..', 'docs', 'screenshots');

async function noHorizontalOverflow(page: Page) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(r.sw, 'horizontal overflow').toBeLessThanOrEqual(r.cw + 1);
}

test.describe('利用者の導線: 見本→素材→仕上げ→保存', () => {
  test('テンプレート選択から素材割当・文字・音楽・保存画面まで', async ({ page }) => {
    mkdirSync(SHOTS, { recursive: true });
    await page.goto('/templates');
    await expect(page.getByRole('heading', { name: '写真を選んで、見本のような動画に。' })).toBeVisible();
    await expect(page.getByText('必要な素材')).toHaveCount(1);
    await noHorizontalOverflow(page);
    await page.screenshot({ path: join(SHOTS, 'templates-390.png'), fullPage: false });

    // S1 → S2
    await page.getByRole('link', { name: 'このテンプレートを見る' }).click();
    await expect(page).toHaveURL(/\/templates\//);
    await expect(page.getByText('写真または動画')).toBeVisible();
    await page.screenshot({ path: join(SHOTS, 'detail-390.png') });
    await page.getByRole('button', { name: 'このテンプレートを使う' }).click();

    // S3: 5 枠
    await expect(page).toHaveURL(/\/projects\/.+\/media/);
    await expect(page.getByText('あと 5 点選んでください')).toBeVisible();
    await page.getByTestId('media-file-input').setInputFiles(SAMPLES.slice(0, 3));
    await expect(page.getByText('あと 2 点選んでください')).toBeVisible();
    // 超過は追加前に制限（3 ファイル渡して 2 だけ入る）
    await page.getByTestId('media-file-input').setInputFiles(SAMPLES.slice(2, 5));
    await expect(page.getByText('素材がそろいました')).toBeVisible();
    await expect(page.getByText('枠の数を超えたため、1 点は追加しませんでした')).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({ path: join(SHOTS, 'media-390.png') });
    // 並べ替え: 1 番の枠をタップ → 次へ
    await page.getByRole('button', { name: /1 番の枠 （素材あり）/ }).click();
    await page.getByRole('button', { name: '次へ', exact: true }).click();
    await page.getByRole('button', { name: '閉じる' }).click();
    await page.getByRole('button', { name: '文字と音楽で仕上げる' }).click();

    // S4: 文字追加・編集
    await expect(page).toHaveURL(/\/edit/);
    await expect(page.getByRole('button', { name: '再生' })).toBeEnabled({ timeout: 20000 });
    await page.getByRole('button', { name: '文字を追加' }).click();
    const ta = page.getByRole('textbox', { name: /本文/ });
    await ta.fill('夏の記録\nSummer');
    await ta.blur();
    await page.getByLabel('書体').selectOption('caveat');
    await expect(page.getByText('筆記体は欧文用です')).toBeVisible();
    await page.getByRole('button', { name: '色 #D7E583' }).click();
    await page.getByRole('button', { name: 'この写真の間だけ' }).click();
    await expect(page.getByText(/0\.0–3\.0 秒/)).toBeVisible();
    await expect(page.getByRole('button', { name: /文字「夏の記録/ })).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({ path: join(SHOTS, 'edit-390.png') });

    // 音楽: 同梱サンプル
    await page.getByRole('tab', { name: '音楽' }).click();
    await page.getByRole('button', { name: '同梱の試聴用音源を使う' }).click();
    await expect(page.getByText(/使う長さ 15\.0 秒/)).toBeVisible({ timeout: 20000 });
    await page.getByLabel('音源の開始（秒）').fill('2');
    await page.getByLabel('音源の終了（秒）').fill('10');
    await expect(page.getByText(/残り 7\.0 秒は無音/)).toBeVisible();
    await page.screenshot({ path: join(SHOTS, 'audio-390.png') });

    // 元に戻す
    await page.getByRole('button', { name: '元に戻す' }).click();
    await expect(page.getByText(/残り 7\.0 秒は無音/)).toHaveCount(0);
    await page.getByRole('button', { name: 'やり直し' }).click();
    await expect(page.getByText(/残り 7\.0 秒は無音/)).toBeVisible();

    // 再読み込み後の復元（Blob URL に依存しない）。自動保存（500ms デバウンス）の完了を待つ
    await expect(page.getByText('保存済み')).toBeVisible({ timeout: 5000 });
    const url = page.url();
    await page.reload();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole('button', { name: /文字「夏の記録/ })).toBeVisible({ timeout: 20000 });
    await page.getByRole('tab', { name: '音楽' }).click();
    await expect(page.getByText(/残り 7\.0 秒は無音/)).toBeVisible();

    // S5
    await page.getByRole('button', { name: '動画を書き出す' }).click();
    await expect(page).toHaveURL(/\/export/);
    await expect(page.getByText(/720×1280・30fps/)).toBeVisible();
    await expect(page.getByRole('button', { name: /書き出す/ }).first()).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({ path: join(SHOTS, 'export-390.png') });

    // S6: 下書きに表示される
    await page.goto('/drafts');
    await expect(page.getByRole('button', { name: '再開' })).toBeVisible();
    await expect(page.getByText('素材そろい')).toBeVisible();
    await page.screenshot({ path: join(SHOTS, 'drafts-390.png') });
  });

  test('実時間録画（MediaRecorder 経路）でも実ファイルが出る（この環境の Chromium で確認できる経路）', async ({ page }) => {
    test.slow();
    await page.goto('/');
    const caps = await page.evaluate(() => (window as unknown as { __cinemix: { probe(): Promise<{ mediaRecorder: { mp4: boolean; webm: boolean } }> } }).__cinemix.probe());
    test.skip(!caps.mediaRecorder.mp4 && !caps.mediaRecorder.webm, 'MediaRecorder なし');
    const res = await page.evaluate(() => (window as unknown as { __cinemix: { exportSample(o: unknown): Promise<{ size: number; extension: string; path: string; durationMs: number; hasAudio: boolean; wallMs: number }> } }).__cinemix.exportSample({ forcePath: 'media-recorder', templateId: '0b6f1d2e-5a3c-4c8e-9d1f-1a2b3c4d5e03' }));
    expect(res.path).toBe('media-recorder');
    expect(res.size).toBeGreaterThan(50_000);
    expect(['mp4', 'webm']).toContain(res.extension);
    expect(res.wallMs).toBeGreaterThanOrEqual(14_000); // 実時間
  });
});

test.describe('作る: 自作テンプレートの保存とパッケージ', () => {
  test('背景写真と秒数を変えて保存し、一覧に出る', async ({ page }) => {
    await page.goto('/creator');
    await page.getByRole('button', { name: /Postcard/ }).click();
    await page.getByLabel(/テンプレート名/).fill('My Postcard');
    await page.getByRole('button', { name: '枠の数と秒数' }).click();
    await page.getByLabel('01 の秒数（1〜8）').fill('2');
    await page.getByLabel('05 の秒数（1〜8）').fill('4.5');
    await expect(page.getByText(/合計 15\.5 秒/).first()).toBeVisible();
    await page.getByRole('button', { name: '閉じる' }).click();
    await page.getByRole('button', { name: '背景', exact: true }).click();
    await page.getByTestId('background-input').setInputFiles(join(process.cwd(), 'public', 'samples', 'background-02.jpg'));
    await expect(page.getByText('背景写真を設定しました')).toBeVisible();
    await page.getByRole('button', { name: '閉じる' }).click();
    await expect(page.getByRole('button', { name: '再生' })).toBeEnabled({ timeout: 20000 });
    await page.getByRole('button', { name: 'この端末に保存' }).click();
    await expect(page.getByText('この端末に保存しました')).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'オンライン共有は未接続' })).toBeDisabled();
    const dl = page.waitForEvent('download');
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: /パッケージを書き出す/ }).click();
    const file = await dl;
    expect(file.suggestedFilename()).toMatch(/\.cinemix-template\.zip$/);
    const path = await file.path();
    // 読み込み（別名で）
    await page.goto('/creator');
    await page.getByTestId('template-import-input').setInputFiles(path!);
    await expect(page.getByText(/「My Postcard」を読み込みました/)).toBeVisible();
    await page.goto('/templates');
    await expect(page.getByText('My Postcard').first()).toBeVisible();
  });
});

test.describe('画面幅', () => {
  for (const vp of [{ w: 360, h: 780 }, { w: 390, h: 844 }, { w: 430, h: 932 }, { w: 1280, h: 800 }]) {
    test(`${vp.w}×${vp.h} で横はみ出しなし`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      for (const path of ['/templates', '/drafts', '/creator', '/account']) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await noHorizontalOverflow(page);
      }
      await page.goto('/templates');
      await page.getByRole('link', { name: 'このテンプレートを見る' }).click();
      await noHorizontalOverflow(page);
      await page.getByRole('button', { name: 'このテンプレートを使う' }).click();
      await page.getByTestId('media-file-input').setInputFiles(SAMPLES);
      await expect(page.getByText('素材がそろいました')).toBeVisible();
      await noHorizontalOverflow(page);
      await page.getByRole('button', { name: '文字と音楽で仕上げる' }).click();
      await expect(page.getByRole('button', { name: '再生' })).toBeEnabled({ timeout: 20000 });
      await noHorizontalOverflow(page);
      await page.screenshot({ path: join(SHOTS, `edit-${vp.w}.png`) });
      const previewBox = await page.locator('.preview').boundingBox();
      expect(previewBox!.width).toBeLessThanOrEqual(vp.w);
    });
  }
});
