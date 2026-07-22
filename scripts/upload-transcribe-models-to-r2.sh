#!/usr/bin/env bash
# /transcribe の Whisper ONNX モデルを Cloudflare R2 へアップロードする（Phase A2）
#
# 前提:
#   1. モデル実体をローカルに取得済みであること
#        node scripts/fetch-transcribe-models.mjs --model all --device all
#      （public/models/transcribe/ 配下に配置され、SHA-256 が検証済みになる）
#   2. wrangler が対象アカウントにログイン済みであること（npx wrangler login）
#      必要権限: R2 の読み書き（Workers R2 Storage:Edit）
#
# 使い方: bash scripts/upload-transcribe-models-to-r2.sh <BUCKET_NAME>
# 例:     bash scripts/upload-transcribe-models-to-r2.sh codelife-models
#
# 配置先キーは `transcribe/<model>/<path>`。
# ブラウザからは Pages Function（functions/models/transcribe/[[path]].ts）経由で
# 同一オリジン /models/transcribe/<model>/<path> として配信される。

set -euo pipefail

BUCKET="${1:?Usage: $0 <BUCKET_NAME>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="${ROOT}/public/models/transcribe"
PREFIX="transcribe"

if [ ! -d "$SRC_DIR" ]; then
  echo "エラー: ${SRC_DIR} がありません。先に以下を実行してください:" >&2
  echo "  node scripts/fetch-transcribe-models.mjs --model all --device all" >&2
  exit 1
fi

content_type() {
  case "$1" in
    *.json) echo "application/json" ;;
    *.txt)  echo "text/plain" ;;
    *)      echo "application/octet-stream" ;;
  esac
}

echo "Bucket: ${BUCKET}"
echo "Source: ${SRC_DIR}"

count=0
while IFS= read -r -d '' file; do
  rel="${file#"${SRC_DIR}/"}"
  key="${PREFIX}/${rel}"
  echo "  → r2://${BUCKET}/${key}"
  wrangler r2 object put "${BUCKET}/${key}" \
    --file="${file}" \
    --content-type="$(content_type "$file")" \
    --remote
  count=$((count + 1))
done < <(find "$SRC_DIR" -type f -print0)

echo ""
echo "✅ 完了: ${count} 個のオブジェクトを r2://${BUCKET}/${PREFIX}/ にアップロードしました"
echo ""
echo "検証:"
echo "  1. npx wrangler pages deploy（または通常のデプロイ）で Pages Function を反映"
echo "  2. curl -I https://tools.codelife.cafe/models/transcribe/whisper-tiny/config.json"
echo "     → 200 / Content-Type: application/json / Cache-Control: immutable を確認"
echo "  3. /transcribe を開き DevTools Network で、モデル取得が同一オリジンのみであることを確認"
