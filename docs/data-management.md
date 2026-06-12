# データ管理とモデル配信設計書

本ドキュメントは、**CODE:LIFE Tools** がクライアントサイドで効率的かつ安全に処理を行うために利用している「郵便番号データ」および「AI背景削除モデル」の管理・配信・更新の仕組みについて記述します。

---

## 1. 郵便番号データのローカル管理

「郵便番号→住所変換」ツールでは、サーバーに問い合わせることなく、クライアントサイドだけで高速に住所を検索する仕組みを構築しています。

### 1.1 データの構造とチャンク分割
日本全国の約12万件の郵便番号データをそのままブラウザに読み込ませると初期ロードが極めて重くなるため、郵便番号の**上2桁**（例: `10`〜`99`）をキーとして、データを約100個の小さなJSONファイルに分割（チャンク化）しています。

- **配置先:** `public/data/zipcode/{00..99}.json`
- **各JSONの構造:**
  ```json
  [
    ["1000000", "東京都", "千代田区", ""],
    ["1000001", "東京都", "千代田区", "千代田"],
    ...
  ]
  ```
- **検索の流れ:**
  1. ユーザーが郵便番号「100-0001」を入力。
  2. アプリは上2桁の「10」をキーにして `public/data/zipcode/10.json` のみを非同期でフェッチ（約数十KB）。
  3. フェッチした配列内から「1000001」を検索し、住所を特定。

### 1.2 メタデータ管理と出典
郵便番号データのバージョン（いつのデータか）と件数は、以下のメタデータファイルで一元管理されています。
- **配置先:** `public/data/zipcode/metadata.json`
- **構造:**
  ```json
  {
    "generatedAt": "2026-06-13T08:08:16.000Z",
    "dataVersion": "2026-06",
    "sourceUrl": "https://www.post.japanpost.jp/service/search/zipcode/download/",
    "sourceLabel": "日本郵便 郵便番号データ",
    "recordCount": 124500,
    "chunkCount": 100
  }
  ```
画面上の「○○年○○月時点のデータ」という表記は、この `dataVersion` から動的に取得・描画されます。

### 1.3 データの更新プロセス
日本郵便の月次データ更新に追従するため、手動でのデータ生成スクリプトを用意しています。ビルド時には実行されません。

#### 更新手順
1. **CSVのダウンロード:**
   - 日本郵便の配布サイトから `utf_ken_all.zip` をダウンロードします。
2. **展開と配置:**
   - zipを展開し、`scripts/.cache/utf_ken_all.csv` に配置します（このディレクトリは `.gitignore` 対象です）。
3. **ジェネレーターの実行:**
   ```bash
   node scripts/generate-zipcode-data.ts
   ```
4. **コミット:**
   - `public/data/zipcode/` に生成された差分（各チャンクJSONと `metadata.json`）を Git にコミットします。

---

## 2. AIモデルの配信と推論 (背景削除ツール)

「背景削除」ツールでは、ブラウザ内でONNXモデルを動かして背景を除去する AI 推論技術を採用しています。

### 2.1 推論の構成要素
- **推論エンジン:** `@huggingface/transformers` (Transformers.js v4)
- **実行環境:** Web Worker (`src/workers/bg-remove.worker.ts`)
  - 重い推論処理やモデルのダウンロード処理がメインスレッド（UI描画）をブロックし、画面がフリーズするのを防ぐため、Web Worker 内に完全に処理を分離しています。
- **対応モデルモデル:**
  - **高速モード (`fast`):** `onnx-community/modnet-webnn` (FP32版、約25.9MB)
  - **高精度モード (`high`):** `onnx-community/BEN2-ONNX` (FP16版、約219MB)

### 2.2 モデルの配信プラットフォーム (Cloudflare R2)
200MBを超える大容量のAIモデルを HuggingFace から都度ダウンロードすると、帯域制限やダウンロードの遅延が発生し、ユーザー体験が著しく低下します。
そのため、本番環境では Cloudflare R2 ストレージから独自にカスタムドメイン経由でモデルを高速配信しています。

- **配信ドメイン:** `https://models.tools.codelife.cafe`
- **バケット名:** `codelife-models`
- **ホスト切り替え制御:**
  - Web Worker 起動時、実行ドメインを判定します。`localhost` 以外の本番ホストであれば自動的に配信元を R2 カスタムドメインに切り替えます。
  - ローカル開発環境（`localhost`）では、自動的に HuggingFace CDN へフォールバックします。
  ```typescript
  if (typeof location !== 'undefined' && location.hostname !== 'localhost') {
      env.remoteHost = 'https://models.tools.codelife.cafe';
  }
  ```

### 2.3 CORS & キャッシュ設定
- **CORS設定:** R2 バケットには `tools.codelife.cafe` および `localhost:4321` からの CORS アクセスを許可するポリシーを設定しています（`scripts/r2-cors.json` で定義）。
- **ブラウザキャッシュ:** ONNXモデルは一度ダウンロードされると、ブラウザの Cache Storage API（`env.useBrowserCache = true`）にキャッシュされ、2回目以降は瞬時に（ミリ秒単位で）モデルロードが完了します。

### 2.4 モデルの更新・メンテナンス

#### モデルの再アップロード
モデルを R2 に新しく追加または更新する場合は、以下のシェルスクリプトを実行します。
```bash
bash scripts/upload-models-to-r2.sh codelife-models
```

#### CORS設定の反映
CORSポリシーを変更した場合は、以下の `wrangler` コマンドで設定を適用します。
```bash
wrangler r2 bucket cors set codelife-models --file scripts/r2-cors.json
```
