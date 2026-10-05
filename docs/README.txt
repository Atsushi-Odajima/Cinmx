CinemiX — Windows 11 での起動と iPhone からの利用手順
作成日: 2026-10-05 / UTF-8

================================================================
0. 前提
================================================================
・Node.js LTS 22（実装・検証は v22.22.0）。pnpm 10（検証は 10.28.0。corepack enable で入る）。
・PowerShell（Windows 11 標準）。
・任意: ffmpeg/ffprobe（出力 MP4 の検証用。利用者の iPhone には不要）。
・グローバル環境を不用意に変えない。pnpm は corepack 経由を推奨。

PowerShell:
  node -v        # v22.x
  corepack enable
  pnpm -v        # 10.x

================================================================
1. セットアップ
================================================================
  cd <このフォルダ>
  pnpm install --frozen-lockfile
  pnpm fonts:prepare      # fontsource から OFL フォントを apps/web/public/fonts へコピー（初回・リポジトリに同梱済みなら省略可）
  Copy-Item .env.example .env   # 値は空のままで A（ローカル編集・書き出し）は動く

必須スクリプト（リポジトリ直下）:
  pnpm dev         # 開発サーバー（http://localhost:5173、PC 確認用）
  pnpm dev:lan     # 同一 Wi-Fi 向け。--host 0.0.0.0 と --mode lan（証明書があれば HTTPS）
  pnpm build       # 本番ビルド → apps/web/dist
  pnpm preview     # ビルド成果物の確認（http://127.0.0.1:4173）
  pnpm typecheck   # 全パッケージの型検査
  pnpm test        # 単体テスト（vitest）
  pnpm test:e2e    # Playwright（Chromium）。apps/web をビルドしてから実行（pnpm build 済みであること）
補助:
  pnpm brand:build        # ブランド PNG の再生成
  pnpm templates:build    # 同梱テンプレートの表紙・見本動画の再生成（ffmpeg 必要）

================================================================
2. iPhone から開く — ルート 1: 同一 Wi-Fi の HTTPS 開発サーバー
================================================================
iPhone の「localhost」は iPhone 自身を指し、Windows ではありません。
http://<LAN-IP> だけでは secure context にならず、PWA（ホーム画面追加・Service Worker）や一部メディア API（WebCodecs 等）が使えません。HTTPS が必要です。

2-1. Windows の LAN IP を確認
  ipconfig
  → 「IPv4 アドレス」（例 192.168.1.23）。Wi-Fi のアダプターの値を使う。

2-2. mkcert で開発用 CA と証明書を作る（公式: https://github.com/FiloSottile/mkcert）
  winget install FiloSottile.mkcert     # または choco install mkcert
  mkcert -install                       # Windows のローカル CA を作成・信頼（初回のみ）
  mkdir certs
  mkcert -key-file certs\dev-key.pem -cert-file certs\dev-cert.pem 192.168.1.23 localhost 127.0.0.1
  ※ IP を自分の LAN IP に置き換える。certs/ は .gitignore 済み。秘密鍵（dev-key.pem）は iPhone に送らない。

2-3. .env に証明書パスを設定
  DEV_HTTPS_CERT=certs/dev-cert.pem
  DEV_HTTPS_KEY=certs/dev-key.pem

2-4. iPhone に「CA 証明書」だけをインストールして完全信頼
  CA の場所:  mkcert -CAROOT  （例 C:\Users\<name>\AppData\Local\mkcert\rootCA.pem。rootCA-key.pem は送らない）
  rootCA.pem を AirDrop・メール等で iPhone へ送り、開く → 設定 →「プロファイルがダウンロードされました」→ インストール。
  設定 → 一般 → 情報 → 証明書信頼設定 → mkcert のルート証明書を「オン」（完全信頼）。
  （Apple の案内: https://support.apple.com/ja-jp/HT204477 「iOS で手動でインストールしたプロファイルの証明書を信頼する」）
  削除するとき: 設定 → 一般 → VPN とデバイス管理 → プロファイルを削除。

2-5. ファイアウォール（必要ポート・プライベートネットワークだけ）
  管理者 PowerShell:
  New-NetFirewallRule -DisplayName "CinemiX dev 5173" -Direction Inbound -Protocol TCP -LocalPort 5173 -Profile Private -Action Allow
  ・全体を無効化しない。ルーターのポート開放はしない。Wi-Fi のネットワークプロファイルが「プライベート」であることを確認（設定 → ネットワークとインターネット → Wi-Fi → ネットワークのプロパティ）。
  ・終了後は  Remove-NetFirewallRule -DisplayName "CinemiX dev 5173"

2-6. 起動して iPhone で開く
  pnpm dev:lan
  → iPhone の Safari で  https://192.168.1.23:5173/  を開く（Windows が起動中で、同じ Wi-Fi にいることが条件）。
  証明書警告が出る場合は 2-4 の完全信頼を確認。

================================================================
3. iPhone から開く — ルート 2: HTTPS のプレビュー URL（静的ホスト）
================================================================
本セッションでは配備先が未指定のため、公開はしていません（公開 URL は存在しません）。
配備するときの要件:
  pnpm build  → apps/web/dist を、ユーザーが指定・承認した静的ホスト（例: 自分のアカウントの Cloudflare Pages / Netlify / Vercel 等）へ配備。
  ・SPA リライト（すべてのパスを /index.html へ）、HTTPS、正しい MIME（.woff2 = font/woff2、.mp4 = video/mp4、.webmanifest）、Range リクエスト（見本 mp4 の再生）、同一オリジンなら CORS 不要、キャッシュ（assets/ は長期、index.html は短期）。
  ・公開前に dist に秘密鍵・.env・私的素材が含まれないことを確認（dist には public/ と assets/ のみ）。
  ・開発サーバー（vite dev）を無認証で一般公開しない。
  ・素材は端末内処理だが、オンライン共有（B）を接続した場合、公開テンプレートの背景写真はアップロードされる。
QR コード: 実在する URL が決まってから生成する（存在しない URL の QR は作らない）。

================================================================
4. iPhone での手順
================================================================
1) Safari で HTTPS の URL を開く。
2) 右上/一覧の「設定・診断」→ 能力診断で「推奨経路: webcodecs」「H.264 可」を確認（不可なら実時間録画または動画保存不可の説明が出る）。
3) 「テンプレート」→ 見本を選ぶ →「このテンプレートを使う」。
4) まず同梱サンプルで試す場合: 「作る」→ Postcard 等を選ぶと中立サンプルで見本が動く。利用者の動画は「素材」画面で写真アプリから 5 点を選ぶ。
5) 「文字と音楽で仕上げる」→ 文字追加（ドラッグ・サイズ・書体・色・表示時間）、音楽（同梱試聴用音源 or 自分の MP3/M4A/WAV）。
6) 「動画を書き出す」→ この画面を開いたまま待つ → 完成後「共有／保存」→ 共有シートの「ビデオを保存」で写真アプリへ。
   ※ Safari から写真アプリへの自動保存はできない。共有のキャンセルは失敗ではない。
7) 必要なら Safari の共有メニュー →「ホーム画面に追加」（PWA）。

================================================================
5. 実機検証の依頼（実行者が iPhone を持たない場合）
================================================================
検証開始時に iPhone の機種・iOS バージョンを確認してください（過去の機種情報を現在のものと断定しない）。
確認してほしい 5 点（結果を docs/TEST_RESULTS.txt の「実機確認表」に記入）:
  a) AC01: https://<LAN-IP>:5173 が開く（証明書警告なし）
  b) 設定・診断の「推奨経路」と「H.264 / AAC」の値（JSON をそのままコピー）
  c) 同梱サンプルで 15 秒の MP4 が書き出せ、写真アプリに保存して再生できる（音あり／なし）
  d) 自分の写真 5 枚＋動画 1 本（MOV、30 秒以下）で書き出せる。回転した縦動画の向きが正しい
  e) 画面ロック中に書き出しが中断されたとき、復帰後に「もう一度試す」で完了する

================================================================
6. よくある問題
================================================================
・https で「接続がプライベートではありません」→ 2-4 の完全信頼が未設定、または証明書の IP が現在の LAN IP と違う（IP が変わったら mkcert で作り直す）。
・ページは開くが動画保存不可 → 設定・診断の notes を確認。iOS 16.4 未満の Safari は WebCodecs 非対応。
・HEIC/HEVC/HDR 素材が読めない → JPEG/PNG、SDR の H.264 MP4 に変換（素材画面に該当ファイルと対処を表示）。
・フォントが出ない → 通信状態（フォントはサーバーから配信、初回のみ）。出力前にフォント読み込みを待ち、失敗時は出力しない。
