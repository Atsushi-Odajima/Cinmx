# CinemiX — テンプレート動画制作アプリ

写真・短い動画・文字・音楽をテンプレートに配置し、縦型動画を制作するWebアプリの試作です。

> **実装ブランチ：`claude/cinemix-web`**。この既定ブランチのREADMEは製品の案内です。以下のソース・資料リンクと起動手順は、実装ブランチを参照します。

## できること

- テンプレート選択、素材の並べ替え・トリミング、文字・音楽の編集
- IndexedDBへの下書き保存、プロジェクトとテンプレートのZIP入出力
- プレビュー、動画書き出し、共有、能力診断と代替録画経路

## 現在の範囲・制限

- iPhone実機、Safari / WebKit、H.264・AACの実機エンコードは既存の試験記録でも未検証です。書き出し可否はブラウザの能力に依存します。
- Supabaseによるクラウド機能は設定と実サーバー検証が別途必要です。Capacitor・AdMob・StoreKitは移行仕様の段階です。

## 実装の見どころ

**構成：** React / TypeScript / Vite、Dexie（IndexedDB）、Canvas、WebCodecs / Mediabunny、pnpm。

- [apps/web/src/screens](https://github.com/Atsushi-Odajima/Cinmx/tree/claude%2Fcinemix-web/apps/web/src/screens)
- [packages/core/src](https://github.com/Atsushi-Odajima/Cinmx/tree/claude%2Fcinemix-web/packages/core/src)
- [packages/render-web/src](https://github.com/Atsushi-Odajima/Cinmx/tree/claude%2Fcinemix-web/packages/render-web/src)
- [packages/storage/src](https://github.com/Atsushi-Odajima/Cinmx/tree/claude%2Fcinemix-web/packages/storage/src)

## ローカルで試す

Node.js 22.12以上、リポジトリで指定されたpnpm。

実装ブランチを取得し、次のディレクトリで作業します。

```sh
git clone --branch claude/cinemix-web https://github.com/Atsushi-Odajima/Cinmx.git
cd Cinmx
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

環境設定・初期化の詳細：[セットアップ手順](https://github.com/Atsushi-Odajima/Cinmx/blob/claude%2Fcinemix-web/docs/README.txt)。
WindowsでBash形式の補助スクリプトを使う場合は、WSL等の対応環境で実行してください。

## 検証方法

`リポジトリ直下` の `package.json` に定義された主な確認コマンドです。DB・ブラウザ・外部ツールを要するものは、開発手順の事前設定が必要です。

```sh
pnpm run typecheck
pnpm run test
pnpm run test:e2e
pnpm run build
```

試験の実施環境・結果・未実施項目は、下記の記録を参照してください。画面エミュレーションと実機確認、モックと外部サービスでの確認を区別しています。

## 資料

- [docs/README.txt](https://github.com/Atsushi-Odajima/Cinmx/blob/claude%2Fcinemix-web/docs/README.txt)
- [docs/STATUS.txt](https://github.com/Atsushi-Odajima/Cinmx/blob/claude%2Fcinemix-web/docs/STATUS.txt)
- [README.md](https://github.com/Atsushi-Odajima/Cinmx/blob/claude%2Fcinemix-web/README.md)
- [画面資料](https://github.com/Atsushi-Odajima/Cinmx/tree/claude%2Fcinemix-web/docs/screenshots)

## 制作・利用条件

制作・管理：**Atsushi Odajima**。実装・資料作成にはAI支援を利用しています。
ソース・同梱ライブラリ・フォント・モデル等の利用条件は、各ライセンスと第三者表記を参照してください。リポジトリの閲覧可能性と、再配布・商用利用の許諾は別です。
