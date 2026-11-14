# Google Analytics / Google Tag Manager

`public/index.html`にGTMコンテナ`GTM-5TFJHDT5`の標準スニペット（headの非同期ローダーとbody直後のnoscript）を設置しています。

Google Analytics 4の計測は、Google Tag Manager側で対象のGA4測定IDを持つGoogleタグを設定し、コンテナを公開すると開始します。GTMのプレビューモード（Tag Assistant）とGA4のリアルタイムレポートで確認してください。アプリ側で別途`gtag.js`を重複設置する必要はありません。
