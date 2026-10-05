# CinemiX

写真を選んで、見本のような動画に。 — iPhone の Safari で使うテンプレート動画制作 Web アプリ（試作）。

- 起動と iPhone からの利用手順: `docs/README.txt`
- 状態（できたこと／未検証／設定待ち）: `docs/STATUS.txt`
- 仕様: `docs/01_implementation_spec.txt`
- テスト結果: `docs/TEST_RESULTS.txt`

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm dev          # http://localhost:5173
pnpm dev:lan      # 同一 Wi-Fi の iPhone 向け HTTPS（docs/README.txt 参照）
pnpm typecheck; pnpm test; pnpm build; pnpm test:e2e
```

構成: `packages/core`（スキーマ・タイムライン・描画）、`packages/storage`（IndexedDB・ZIP）、`packages/platform`（Adapter 境界・Supabase）、`packages/render-web`（デコード・MP4 書き出し）、`apps/web`（React PWA）、`supabase/`（B 段階のサーバー構成）、`docs/`。
