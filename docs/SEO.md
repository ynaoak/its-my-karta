# SEOと共有表示

公開サイトの正規URLは `https://yondetotte.oshi-katsu.com/`。公開中の紹介ページはトップページ1件で、ログイン後の編集データや期限付き対戦URLはサイトマップに載せません。

## 実装

- 日本語のtitle・description、canonical、OGP、X/Twitterカード、favicon、Apple用アイコン
- `WebSite`と`WebApplication`のJSON-LD。架空の評価・価格・利用者数は記載しません
- JavaScriptなしでも読める遊び方・FAQと見出し構造
- `/sitemap.xml`は正規URLのみ。`/robots.txt`にSitemapを記載しAPIを除外
- `?room=...`はWorkerがHTTP `X-Robots-Tag: noindex, nofollow`とHTMLのrobotsメタタグを設定。ブラウザJavaScriptに依存しません
- 本番origin以外（workers.devのプレビュー、ローカル等）はnoindex、robotsもクロール拒否
- `/index.html`から`/`へ308リダイレクト。招待用クエリは保持します
- フォントのCSS `@import`をやめ、headでpreconnectと`display=swap`付きstylesheetを読み込み

招待URLはrobots.txtでクロール拒否にしていません。検索エンジンがHTTPのnoindexを読めるようにするためです。noindexはアクセス制御ではありません。かるたの所有権は既存のClerk認証とD1の所有者検証で保護します。

## 公開後に行うこと

1. この変更を含めてCloudflareへデプロイします。HTML用のnoindexはWorkerルーティングも必要なので、静的ファイルだけをアップロードしないでください。
2. Google Search ConsoleでドメインまたはURLプレフィックスの所有権を確認します。所有権確認用の値は本リポジトリでは発行できません。
3. Search Consoleのサイトマップに `https://yondetotte.oshi-katsu.com/sitemap.xml` を送信します。
4. URL検査でトップページの公開URLをテストし、必要に応じてインデックス登録をリクエストします。招待URLは登録対象にしません。
5. リッチリザルトテストやSchema Markup Validatorで構造化データ、SNSの共有プレビューで画像を確認します。

検索エンジンへの登録・順位やリッチリザルト表示は保証されません。GA4はアクセス計測であり、Search Consoleへの登録とは別です。公開環境での検索登録は所有者が上記の確認を行ってください。

## 更新・検証

サイトのURLを変更する場合は、`src/seo.ts`の`SITE_ORIGIN`、HTMLのcanonical/OGP/JSON-LD、sitemap、robotsを一緒に変更します。公開ページを追加した場合だけsitemapへ追記してください。最終更新日は偽装せず、現在は`lastmod`を省略しています。

OGP画像は`public/og-image.svg`が編集用、`public/og-image.png`がSNS向けの1200×630 PNGです。SVGとfaviconの変更後は、Chromiumを導入した開発環境で `npm run seo:images` を実行してPNGをコミットします。CloudflareのビルドでChromiumを起動する必要はありません。

`npm run test:seo`は実ローカルWorkerでレスポンス・noindex・XML・メタデータを確認し、Chromiumでモバイル表示、FAQ、JavaScript無効時のコンテンツ、PNGの寸法も検証します。Search Consoleや実SNSへの公開送信はしません。
