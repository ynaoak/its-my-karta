# Google Analytics / Google Tag Manager

Google AnalyticsとGoogle Tag Managerは、Cloudflareの「Google タグ ゲートウェイ」で配信します。そのため`public/index.html`にはGTMやgtag.jsのスニペットを置いていません。

計測の設定（GTMコンテナ`GTM-P2XJ856K`、GA4のGoogleタグ）はCloudflareのダッシュボードとGTM側で管理します。アプリ側にスニペットを追加すると二重計測になるため、追加しないでください。
