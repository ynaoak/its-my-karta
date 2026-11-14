# わたしのかるた

50音の読み札と画像を作成し、招待URLで集まって遊ぶブラウザゲーム。Cloudflare Workers上で動作します。

## 機能

- 46音ごとの文章、画像選択・縮小、お絵描き、JSON入出力、ブラウザ下書き
- Clerkログイン、ユーザー別のD1クラウド保存・読込・削除、同時編集の競合検知
- 主催者のみ対戦作成・開始・終了。ゲストはログインせず最大12人で参加
- 記憶時間の後、ランダムな読み札を表示・自動読み上げ。同じ札配置で先着タップをサーバー判定
- 全札終了、制限時間、目標枚数先取の3ルール
- 終了・絶対期限（最大24時間）でDurable Objectの保存データとalarmを削除。URL再利用不可
- 録音・アップロード音声をR2に保存して再生。音声クレジット表示、端末音声の種類・速度選択
- オプションのVOICEVOXエンジンで自動生成。指定クレジット付き37キャラクターを許可リスト化
- 日本語WASM音声生成：piper-plus + ONNX Runtime Web、Worker上でローカル推論、R2に保存

## 構成とスケール

| 用途                                           | Cloudflareサービス                            | 保存期間             |
| ---------------------------------------------- | --------------------------------------------- | -------------------- |
| HTML/CSS/JS、API、Clerk JWT検証                | Workers + Static Assets                       | デプロイ単位         |
| 部屋・参加者・進行・先着判定                   | SQLite Durable Objects、WebSocket hibernation | 終了・期限切れまで   |
| 編集用タイトル・札の文章・メディア参照・版番号 | D1                                            | 利用者が削除するまで |
| 画像・個別音声・WASM・モデル                   | R2                                            | 管理者が削除するまで |

各対戦に独立したDOを割り当てるため、別々の主催者による多数の部屋は別インスタンスへ分散します。単一部屋へのアクセスは直列化されます。利用増加時はWorkers/DO/D1/R2のリクエスト数、接続数、CPU、ストレージ料金・アカウント上限を監視してください。本PRの検証は機能検証であり、大規模負荷試験ではありません。

D1の編集データから対戦開始時にスナップショットを作ります。対戦が終了しても編集用データは消えません。R2は共有ハッシュ参照なので、部屋やライブラリ削除でメディアは削除しません。既知のメディアURLは公開です。R2オブジェクトの整理には別途参照確認の運用が必要です。

## ローカル起動

Node.js 26.13.1（LTS）。`.node-version` / `.nvmrc` とCIで同じバージョンを指定しています。nvmを使う場合は `nvm install && nvm use` で切り替えてください。

```sh
npm ci
npm run build
cp .dev.vars.example .dev.vars
# Clerkの実際のキーと許可originを.dev.varsへ設定
npm run db:migrate:local
node scripts/install-tts.mjs
npm run dev
```

`http://localhost:8787` を開きます。Clerk未設定でもおためし編集は可能ですが、クラウド保存・メディアアップロード・対戦作成は無効です。ローカルと本番のClerkインスタンス・許可originを合わせてください。JWT public keyはClerk Dashboardから取得する公開鍵です。Clerkは外部サービスのためログインには接続が必要です。

画像・音声はアップロード時にコンテナ形式を判定します。画像3MB、音声5MB、読み札200文字まで。端末録音にはHTTPSまたはlocalhostとマイク許可が必要です。入力途中の文章や画像はブラウザ下書きに保存されますが、クラウド保存・対戦に反映するには「この札を保存」を押してください。

## 本番作成・デプロイ

初回導入は [Cloudflare・Clerkの設定手順](docs/DEPLOYMENT.md) を参照してください。`npm run deploy:check` でD1 IDとビルド成果物を確認できます。

```sh
npx wrangler login
npx wrangler r2 bucket create its-my-karta-media
npx wrangler d1 create its-my-karta-db
# 返された database_id を wrangler.jsonc の DB 設定に追加
npx wrangler secret put CLERK_PUBLISHABLE_KEY
npx wrangler secret put CLERK_JWT_KEY
npx wrangler secret put CLERK_AUTHORIZED_PARTIES
npm run db:migrate:remote
npm run deploy
```

`CLERK_AUTHORIZED_PARTIES` は実際の公開origin（複数はカンマ区切り）です。Workers Buildsではビルドコマンド `npm ci && npm run build`、デプロイコマンド `npm run db:migrate:remote && npx wrangler deploy`。D1 migrationを適用できる権限のトークンが必要です。`npm run deploy` はビルド後に `wrangler deploy` を実行するラッパーです。DOのSQLite migrationはWrangler設定に含まれます。R2/D1は実在リソースを設定してから本番デプロイしてください。

## 音声

1. 札に録音・アップロード・生成した音声があれば優先再生。文章変更で`audioText`と一致しなくなると端末音声へフォールバック。
2. 個別音声がなければブラウザのWeb Speech API。日本語音声の種類はOSとブラウザ依存。再生には「音声を有効にする」を押します。
3. VOICEVOXは管理者のHTTPSエンジンがある場合だけ使用。`VOICEVOX_ENGINE_URL`、必要なら`VOICEVOX_API_KEY`をWorker secretsに設定。WorkersでネイティブVOICEVOX実行はできません。エンジンは認証ゲートウェイで保護してください。
4. WASMは外部TTS APIを使わずブラウザ内で合成します。**VOICEVOX公式モデルを移植したものではありません。** 公開の日本語ONNXモデルとライセンス確認が必要です。[WASMモデル調査](docs/WASM-TTS.md)に配置方法・制約があります。未承認モデルを自動ダウンロード・有効化しません。

[44キャラクターの調査一覧](docs/VOICEVOX-LICENSES.md)と[公式規約スナップショット](docs/voicevox-audit.json)。選択肢は公式同梱要約上、指定クレジット付きで商用利用できる37キャラクターです。リンク先の詳細規約・更新・サービス提供形態の確認は別途必要です。クレジットは音声に紐付けてクラウド保存・対戦画面に表示します。

## 検証

```sh
npm run check
npm test
npm run test:integration
npm run test:browser
npx wrangler deploy --dry-run
```

統合テストは実際のローカルWorkers/DO/D1/R2と一時RSA鍵のClerk形式JWTを使用します。外部Clerk実サービスへのログインは含みません。ブラウザテストはChromium（`CHROMIUM_PATH`で指定可能）とClerk UIのテストfixtureを使います。ゲームの先着はサーバー到着順で、通信遅延差を補正しません。開始後の再接続・途中参加には対応していません。部屋IDは推測困難ですが、招待URLは公開場所へ貼らないでください。

本番へのデプロイ・外部Clerk/VOICEVOXの実接続はこのPRに含みません。
