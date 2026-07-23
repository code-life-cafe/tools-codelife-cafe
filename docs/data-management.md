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
4. **更新後の検証:**
   - `public/data/zipcode/metadata.json` を開き、`generatedAt`、`dataVersion`、`recordCount`、`chunkCount` が最新の生成結果として妥当であることを確認します。
   - `public/data/zipcode/{00..99}.json` が生成されていることを確認し、空ファイルや破損した JSON がないことを確認します。
   - 画面上で代表的な郵便番号（例: `1000001`、`1500001`、`5300001`）を検索し、期待する住所が表示されることを確認します。
   - `git diff public/data/zipcode/` を実行し、想定外の大量削除や JSON 形式の変更が含まれていないことを確認します。
   - 日本郵便データのライセンス・出典表記が、`metadata.json` と画面表示の両方で維持されていることを確認します。
5. **コミット:**
   - `public/data/zipcode/` に生成された差分（各チャンクJSONと `metadata.json`）を Git にコミットします。

---

## 2. AIモデルの配信と推論 (背景削除・画像アップスケールツール)

「背景削除」および「画像アップスケール・ノイズ除去」ツールでは、ブラウザ内でONNXモデルを動かすAI推論技術を採用しています。

### 2.1 推論の構成要素
- **推論エンジン / ライブラリ:**
  - 背景削除: `@huggingface/transformers` (Transformers.js v4)
  - 画像アップスケール: `onnxruntime-web` (Real-ESRGAN ONNX, jsDelivr CDN配信WASM)
- **実行環境 (Web Worker):**
  - 背景削除: `src/workers/bg-remove.worker.ts`
  - 画像アップスケール: `src/workers/upscale.worker.ts`
  - 重い推論処理、モデルのダウンロード、タイル分割処理がメインスレッド（UI描画）をブロックし画面がフリーズするの完全防止するため、Web Worker 内に処理を隔離し、OffscreenCanvas 等を活用しています。
- **対応モデル (背景削除):**
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

### 2.5 運用・障害対応

#### 配信元の切り替え条件
- **本番環境:** Web Worker の実行ホストが `localhost` 以外の場合は、`src/workers/bg-remove.worker.ts` で `env.remoteHost` を `https://models.tools.codelife.cafe` に設定し、Cloudflare R2 のカスタムドメインからモデル静的ファイルを取得します。
- **ローカル開発環境:** Web Worker の実行ホストが `localhost` の場合は `env.remoteHost` を上書きせず、Transformers.js の標準挙動により HuggingFace CDN からモデル静的ファイルを取得します。これにより、R2 の本番配信設定に依存せず開発・検証できます。
- **プライバシー:** いずれの配信元を利用する場合でも、外部から取得されるのは ONNX モデルなどの静的ファイルのみです。ユーザーが選択した画像は Web Worker 内の推論処理にだけ使用され、推論のために外部サーバーへ送信されません。

#### モデル取得失敗時の確認項目
モデルのダウンロードや初期化に失敗した場合は、以下を順に確認します。

1. **R2 オブジェクト存在:** 対象モデルの ONNX ファイル、設定ファイル、関連アセットが `codelife-models` バケット内の期待パスに存在すること。
2. **CORS 設定:** `scripts/r2-cors.json` の許可オリジンに本番ドメインおよびローカル開発用オリジンが含まれ、R2 バケットへ反映済みであること。
3. **レスポンスヘッダー:** ブラウザ DevTools の Network タブで、モデル取得レスポンスに `Access-Control-Allow-Origin`、適切な `Content-Type`、キャッシュ関連ヘッダーが付与されていること。
4. **ブラウザ Cache Storage:** 古いモデルや失敗レスポンスが Cache Storage に残っていないこと。必要に応じて Application タブから該当キャッシュを削除します。
5. **Service Worker 影響:** PWA の Service Worker が古いキャッシュを返していないこと。更新確認、登録解除、またはキャッシュ削除後に再読み込みして挙動を確認します。

#### モデル更新時の確認手順
モデルを追加・更新した場合は、以下の手順で配信と推論の両方を確認します。

1. `scripts/upload-models-to-r2.sh` でアップロードした後、`https://models.tools.codelife.cafe` 配下の対象 URL をブラウザまたは `curl` で直接開き、HTTP ステータスとレスポンスヘッダーを確認します。
2. 背景削除ツールを開き、**高速モード (`fast`)** と **高精度モード (`high`)** の両方でサンプル画像を処理し、モデルロードと推論が完了することを確認します。
3. ブラウザの Cache Storage と Service Worker のキャッシュをクリアした後、再度背景削除ツールを開き、モデル静的ファイルが再取得されることを Network タブで確認します。

#### 関連ファイル
- `src/workers/bg-remove.worker.ts`: 背景削除用 Web Worker。モデル配信元の切り替え、ブラウザキャッシュ利用、推論処理を管理します。
- `scripts/upload-models-to-r2.sh`: HuggingFace 由来のモデルファイルを Cloudflare R2 バケットへアップロードする運用スクリプトです。
- `scripts/r2-cors.json`: R2 バケットへ適用する CORS ポリシー定義です。

---

## 3. 文字起こしモデルの配信 (/transcribe)

「文字起こし（ローカル）」ツールは、上記2ツールとは**配信方式が異なります**。音声・文字起こし結果を
一切外部に出さないことを不変条件とするため、`/transcribe` では CSP の `connect-src` を `'self'` に
限定しています。クロスオリジンの `models.tools.codelife.cafe` を直接叩く方式はこれと両立しないため、
**同一オリジン `/models/transcribe/**` 経由で R2 をプロキシ**します。

### 3.1 マニフェスト（正本）

配信対象・コミットハッシュ・SHA-256・dtype は `src/lib/transcribe/model-manifest.ts` が正本です。
このファイルは自動生成であり、手で編集しません。

```bash
npm run transcribe:manifest   # HuggingFace を参照してマニフェストを再生成（手動実行）
```

マニフェストに列挙されていないファイルは、Pages Function 側でも 404 になります
（暗黙のパス解決・HuggingFace へのフォールバックを禁止するため）。

### 3.2 dtype の選定（実測ベース）

transformers.js / ONNX Runtime Web の組み合わせによって、動作する dtype が変わります。
採用値は whisper-tiny で全 dtype を総当たりして決定したもので、根拠は
`scripts/generate-transcribe-manifest.mjs` の冒頭コメントに表として残しています。

| デバイス | dtype | 配信量（tiny / base / small） |
|---|---|---|
| WebGPU | `q8` | 39MB / 73MB / 238MB |
| WASM | `bnb4` | 90MB / 133MB / 274MB |

**ライブラリを更新した場合は、この表を取り直してから dtype を変更してください。**

### 3.3 ローカル開発

モデル実体（数百MB）と ONNX Runtime の WASM はリポジトリに含めず、`.gitignore` 対象です。

```bash
npm run transcribe:models              # public/models/transcribe/ へ tiny を取得（SHA-256 検証つき）
npm run transcribe:models -- --model all --device all
npm run transcribe:wasm                # public/vendor/onnx-wasm/ へ WASM を配置（npm run build が自動実行）
```

`copy-onnx-wasm.mjs` は、`@huggingface/transformers` が解決している `onnxruntime-web` の
バージョン・SHA-256 がマニフェストと一致しない場合に `exit 1` します
（JS 側と WASM 側の版ずれをビルド時に検出するため）。

### 3.4 R2 配置 (Phase A2)

```bash
node scripts/fetch-transcribe-models.mjs --model all --device all
node scripts/upload-transcribe-models-to-r2.mjs codelife-models --dry-run
node scripts/upload-transcribe-models-to-r2.mjs codelife-models
```

- オブジェクトキーは `transcribe/<model>/<path>`（既存の `/bg-remove` 用オブジェクトと分離）。
- ブラウザへの配信は `functions/models/transcribe/[[path]].ts`（R2 バインディング `TRANSCRIBE_MODELS`）が担当します。
- 必要権限: Cloudflare アカウントの **Workers R2 Storage: Edit**（`wrangler login` 済みであること）。
- アップロード前にマニフェストの SHA-256 を再検証します。同じキーへの上書きなので、途中で中断しても再実行すれば続きから揃います。

> **WSL から実行する場合の注意**: Windows 側にグローバルインストールした wrangler を WSL から呼ぶと、
> `workerd` のネイティブバイナリがプラットフォーム不一致で起動できません
> （`@cloudflare/workerd-windows-64` is present but this platform needs ...-linux-64）。
> Windows 側（PowerShell / Git Bash）で実行するか、WSL 側に Linux 版を入れて
> `WRANGLER_BIN=./node_modules/.bin/wrangler` を指定してください。

### 3.5 関連ファイル
- `src/lib/transcribe/model-manifest.ts`: 配信対象の正本（自動生成）。
- `scripts/generate-transcribe-manifest.mjs`: マニフェスト生成。dtype 選定の実測表もここ。
- `scripts/fetch-transcribe-models.mjs` / `scripts/copy-onnx-wasm.mjs`: ローカル取得・版ずれ検出。
- `functions/models/transcribe/[[path]].ts`: 同一オリジン配信の Pages Function。
- `src/workers/transcribe.worker.ts`: 推論 Worker（`allowRemoteModels = false`、`wasmPaths` 固定）。
