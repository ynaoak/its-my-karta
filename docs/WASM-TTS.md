# 日本語WASM TTS

## 調査・採用方式

VOICEVOXのデスクトップUI自体をWASM化しても音声エンジンにはなりません。公式音声合成は別のVOICEVOX Engine/CoreとVVMモデルに依存します。ブラウザではネイティブONNX RuntimeやOS依存DLLは実行できず、モデル形式・実行プロバイダ・各音声の規約がそれぞれ必要です。公式VOICEVOXと同じ声・品質をこの実装が提供するものではありません。

代替は `piper-plus@0.8.2` のRust/WASM日本語G2P（jpreprocess / NAIST-JDIC内蔵）と `onnxruntime-web@1.30.0` によるVITS ONNX推論です。どちらもブラウザWeb Workerで実行し、スレッド数1、WASM CPUバックエンドを使います。外部のTTS APIを呼ばず、生成結果をWAVとしてR2に保存します。デフォルト再生は生成済みWAVか端末Web Speech APIです。

候補モデル： https://huggingface.co/ayousanz/piper-plus-tsukuyomi-chan 。パッケージ本体のMITライセンスと音声モデル・音声素材の利用規約は別物です。モデルカード、つくよみちゃんの利用規約、再配布・商用利用・クレジット、提供サービスへの組込条件を確認してください。運営者が確認するまで本番モデルは有効にしません。

コードとruntimeのライセンスは `npm run build` で `public/vendor/` にコピーします。モデルに固有のクレジットは生成音声と一緒に保存します。

## 本番モデルを有効化する

1. `npm ci && npm run build`。58MBのG2P WASMなど大きなファイルはStatic Assetsの制限を避け、`.cache/tts/runtime/`へ出力されます。
2. 日本語対応ONNXを `.cache/tts/model.onnx`、対応設定を `.cache/tts/model.onnx.json` に配置します。設定の `language_id_map` に `ja` が含まれることを確認します。異なるモデル用の辞書・音素マップを組み合わせないでください。
3. 利用条件を確認し、 `.cache/tts/approval.json` を作成します。これは自動承認ではなく、運営者が実際に確認した事実の記録です。

```json
{
  "reviewed": true,
  "model": "tsukuyomi",
  "credit": "確認したモデルの規約で指定された実際のクレジット",
  "source": "取得元と固定リビジョン",
  "terms": "確認した利用規約URLと確認日"
}
```

4. `node scripts/install-tts.mjs --model` でローカルR2へ配置。本番は `node scripts/install-tts.mjs --model --remote --confirm-production-upload`。WASM本体・モデルはGitに含めません。承認情報と必要ファイルがすべてあるとUIが有効になります。
5. 実際のモデルで日本語の読み、品質、性能、メモリ使用量を確認します。推論開始前に大容量のモデル取得が必要です。高性能端末を推奨し、生成キャンセルはWorkerをterminateします。生成中は進捗と失敗理由を表示します。45秒超・無音・非有限値の結果は拒否します。

## 参考

- https://github.com/VOICEVOX/voicevox
- https://github.com/VOICEVOX/voicevox_core
- https://github.com/ayutaz/piper-plus
- https://www.npmjs.com/package/piper-plus/v/0.8.2
- https://github.com/microsoft/onnxruntime
- https://tyc.rei-yumesaki.net/about/terms/

公開テスト用モデルで推論経路を検証しても、本番モデルの品質・利用権を保証するものではありません。テストモデルの承認情報を本番にアップロードしないでください。
