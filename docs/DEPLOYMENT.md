# 初回の本番導入

ソースのmainマージだけでは、D1/R2/Clerkの本番設定は作成されません。まずCloudflareアカウントとClerkアプリを用意します。秘密キーはチャットやGitに記載せず、CloudflareのVariables and SecretsまたはWrangler経由で登録します。

## 1. Cloudflareへの接続

手元のPCでも実施できます。Node.js 26.13.1（LTS）でリポジトリを取得し、次を実行します。

```sh
npm ci
npx wrangler login
npx wrangler whoami
```

自動実行環境では、必要な権限を持つCloudflare APIトークンを`CLOUDFLARE_API_TOKEN`、アカウントIDを`CLOUDFLARE_ACCOUNT_ID`として実行環境の安全な変数設定へ登録します。Workers/Static Assetsのデプロイ、D1の作成・migration、R2の作成・書込に必要な権限を付けます。`wrangler login`のブラウザ認証が使えるPCではトークンの手入力は不要です。

このクラウド環境から操作する場合は`api.cloudflare.com`への通信許可も必要です。現在の環境では未許可のため、許可を変更できない場合は手元のPCやCloudflare側のビルドから実行してください。

## 2. D1とR2を作成

```sh
npx wrangler d1 create its-my-karta-db
npx wrangler r2 bucket create its-my-karta-media
```

すでに同名リソースがある場合は再作成せず、`npx wrangler d1 list`、`npx wrangler r2 bucket list`で確認します。R2を初めて使うアカウントでは、Cloudflare DashboardでR2を有効にする操作が必要な場合があります。

採用中のWranglerは、`database_id`を省略した場合、`database_name`で既存D1を解決します。デフォルト設定の`its-my-karta-db`を作成済みなら、そのまま名前で指定できます。IDで接続先を固定したい場合は、D1作成結果の実際の`database_id`を`binding: "DB"`の項目へ追加し、コミットしてください。`database_id`とアカウントIDは秘密キーではありません。独自名を使う場合は`database_name`と`bucket_name`を実際の名前に合わせます。

```jsonc
"d1_databases": [{
  "binding": "DB",
  "database_name": "its-my-karta-db",
  "database_id": "作成結果の実際のUUID",
  "migrations_dir": "migrations"
}]
```

## 3. Clerkを設定

Clerk Dashboardでアプリを作成し、使用するサインイン方式を有効にします。本番運用ではClerkのProductionインスタンスを構成してください。

Cloudflare Worker `its-my-karta` に次を設定します。Wranglerから設定する場合のコマンドは以下です。

```sh
npx wrangler secret put CLERK_PUBLISHABLE_KEY
npx wrangler secret put CLERK_JWT_KEY
npx wrangler secret put CLERK_AUTHORIZED_PARTIES
```

| 名前                       | 値                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `CLERK_PUBLISHABLE_KEY`    | そのClerkインスタンスの`pk_live_...`または開発用`pk_test_...`                                         |
| `CLERK_JWT_KEY`            | 同じインスタンスのJWT public key（PEM）。Clerk secret keyではありません                               |
| `CLERK_AUTHORIZED_PARTIES` | 実際の公開origin。例：`https://its-my-karta.example.com`。末尾`/`やパスを付けず、複数ならカンマ区切り |

独自ドメインまたはCloudflareの`workers.dev` URLを先に決め、そのoriginをClerk側の許可設定とWorker側の`CLERK_AUTHORIZED_PARTIES`に一致させます。公開originが変わったら両方更新してください。

## 4. ビルド、migration、デプロイ

```sh
npm run build
npm run deploy:check
npm run db:migrate:remote
npm run deploy
```

`deploy:check`はD1の名前またはID、R2/DOのbinding、生成済み静的ファイル、Static Assetsのファイルサイズをローカルで確認します。Cloudflareへの通信、リソース存在、Clerkの実設定は確認しません。D1を名前で指定するデフォルト設定でも通ります。明示したIDが不正な場合や、名前とIDの両方がない場合は停止します。既存D1が未作成の場合は、後続のリモートmigrationでエラーになるため、先に手順2で作成してください。

Workers Buildsを使う場合は、ビルド環境変数 `NODE_VERSION=26.13.1` を設定します（Worker実行時の環境変数ではありません）。ビルドコマンド`npm ci && npm run build`、デプロイコマンド`npm run deploy:check && npm run db:migrate:remote && npx wrangler deploy`を設定します。実行するCloudflareトークンにはD1 migrationの権限も必要です。

## 5. 公開後の確認

- 公開URLを開き、Clerkでログイン・ログアウトできる。
- おためし札を作り、クラウド保存後に別ブラウザから復元できる。
- 招待URLへログインしていないブラウザから参加し、対戦を開始・終了できる。
- 終了した招待URLでは参加できず、ライブラリのかるたは残る。
- 録音音声をアップロードし、音声を有効化した対戦画面で再生できる。

## オプションの自動音声生成

録音・アップロード音声と端末の標準読み上げは、追加の音声サーバーなしで利用できます。

VOICEVOX生成を使う場合は、管理者が運営する認証付きHTTPSエンジンを用意し、`VOICEVOX_ENGINE_URL`と必要に応じて`VOICEVOX_API_KEY`をWorker secretsへ設定します。詳細な音声利用条件は`VOICEVOX-LICENSES.md`を確認してください。

WASM生成には`npm run build`後に`node scripts/install-tts.mjs --remote --confirm-production-upload`でランタイムをR2へ配置し、`WASM-TTS.md`に従って規約を確認した本番モデルを設定します。公開テストモデルは本番へ配置しません。モデルを設定するまではWASM生成だけ無効です。

## プレビュービルド（`previews`ブロックが必要というエラー）

Cloudflareの非本番ブランチは`wrangler preview`で配信されます。通常の`wrangler deploy`とは設定が別で、トップレベルのbindingや環境変数は自動継承されません。`wrangler.jsonc`の`previews`に、次を指定しています。

| 用途       | 本番                 | プレビュー                                  |
| ---------- | -------------------- | ------------------------------------------- |
| R2 `MEDIA` | `its-my-karta-media` | `its-my-karta-media-preview`                |
| D1 `DB`    | `its-my-karta-db`    | `its-my-karta-db-preview`                   |
| DO `ROOMS` | 本番の名前空間       | Previewごとに自動生成される独立した名前空間 |

### 一度だけ行う設定

Cloudflareへログインした端末で、プレビュー用リソースを作成します。すでに存在する場合は再作成しません。

```sh
npx wrangler r2 bucket create its-my-karta-media-preview
npx wrangler d1 create its-my-karta-db-preview
```

### Cloudflare Workers Buildsのコマンド

- ビルド：`npm ci && npm run build`
- 本番デプロイ：`npm run deploy:check && npm run db:migrate:remote && npx wrangler deploy`
- 非本番ブランチのデプロイ：`npm run deploy:preview`

`deploy:preview`はビルド後、`previews`の設定を確認し、**専用の`its-my-karta-db-preview`**へmigrationを適用してから`wrangler preview`を実行します。非本番ブランチのデプロイで`db:migrate:remote`を使用すると本番DBが対象になるので、プレビューには使いません。プレビュー用R2/D1はブランチ間で共有しますが、本番とは分離されています。

Clerkの本番secretsはPreviewへ自動継承されません。初回はテスト用ClerkのキーをPreviews Baseに登録し、Preview URLが確定したら、そのoriginを`CLERK_AUTHORIZED_PARTIES`とClerk側に設定します。

```sh
npx wrangler preview base-config secret put CLERK_PUBLISHABLE_KEY
npx wrangler preview base-config secret put CLERK_JWT_KEY
# URLが確定したPreviewに、そのoriginを登録
npx wrangler preview secret put CLERK_AUTHORIZED_PARTIES --name 対象ブランチ名
```

既存Previewでは必要に応じて`preview secret put`で各キーも更新してください。Base secretの変更は新規Previewに適用され、作成済みPreviewには自動反映されません。Clerk未設定でも閲覧とおためし編集はできますが、ログインが必要な機能は無効です。

参考： [Cloudflare公式のPreview設定](https://developers.cloudflare.com/workers/previews/configuration/)。

## Clerkが「古いバージョンのためサインインできません」と表示する場合

Clerk JS v5を読み込んでいるデプロイは、Clerkインスタンスの設定によってサインインを拒否されることがあります。`public/clerk-auth.js`で正式版のClerk JS 6.43.1と、v6で別配布になったUI 1.42.6を読み込み、`clerk.load({ ui: { ClerkUI } })`で初期化します。サーバー側はBackend SDK 3.29.0を使用します。

修正を含むブランチをmainにマージし、`npm ci`からビルド・再デプロイしてください。その後、ブラウザを再読み込みします。公開URL `https://yondetotte.oshi-katsu.com/` のDevTools → Networkで、`clerk-js@6.43.1/dist/clerk.browser.js`と`ui@1.42.6/dist/ui.browser.js`が正常に取得されていることを確認します。古いv5のリクエストが残る場合は、Workers Buildsの対象ブランチ・デプロイ結果とブラウザキャッシュを確認してください。

この更新のために`CLERK_JWT_KEY`を`CLERK_SECRET_KEY`へ置き換える必要はありません。JWT public keyとPublishable keyは、これまでどおり同じClerkインスタンスのものを使用します。
