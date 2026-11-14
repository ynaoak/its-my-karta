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

D1作成結果の`database_id`を`wrangler.jsonc`の`binding: "DB"`の項目へ追加し、変更をリポジトリへコミットしてください。`database_id`とアカウントIDは秘密キーではありません。独自名を使う場合は`database_name`と`bucket_name`を実際の名前に合わせます。

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

`deploy:check`はD1のID、R2/DOのbinding、生成済み静的ファイル、Static Assetsのファイルサイズをローカルで確認します。Cloudflareへの通信、リソース存在、Clerkの実設定は確認しません。デフォルト設定では実際のD1 IDがないため失敗するのが正常です。

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
