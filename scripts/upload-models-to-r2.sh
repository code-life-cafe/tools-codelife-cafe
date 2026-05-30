#!/usr/bin/env bash
# HuggingFace からモデルをダウンロードし Cloudflare R2 にアップロードする
# 使い方: bash scripts/upload-models-to-r2.sh <BUCKET_NAME>
# 例:     bash scripts/upload-models-to-r2.sh codelife-models

set -euo pipefail

BUCKET="${1:?Usage: $0 <BUCKET_NAME>}"
HF_BASE="https://huggingface.co"
TMP_DIR="$(mktemp -d)"

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

download() {
  local model="$1" file="$2"
  local url="${HF_BASE}/${model}/resolve/main/${file}"
  local dest="${TMP_DIR}/${model}/resolve/main/${file}"
  mkdir -p "$(dirname "$dest")"
  echo "  Downloading ${model}/${file} ..."
  curl -fL --retry 3 --retry-delay 2 -o "$dest" "$url"
}

upload() {
  local model="$1" file="$2"
  local local_path="${TMP_DIR}/${model}/resolve/main/${file}"
  local r2_key="${model}/resolve/main/${file}"
  echo "  Uploading → r2://${BUCKET}/${r2_key}"
  wrangler r2 object put "${BUCKET}/${r2_key}" \
    --file="${local_path}" \
    --content-type="$(content_type "$file")" \
    --remote
}

content_type() {
  case "$1" in
    *.json) echo "application/json" ;;
    *.onnx) echo "application/octet-stream" ;;
    *)      echo "application/octet-stream" ;;
  esac
}

process_model() {
  local model="$1"
  shift
  local files=("$@")

  echo ""
  echo "=== ${model} ==="
  for f in "${files[@]}"; do
    download "$model" "$f"
    upload   "$model" "$f"
  done
}

echo "Bucket: ${BUCKET}"
echo "Temp dir: ${TMP_DIR}"

# --- MODNet (高速・人物特化, fp32) ---
process_model "onnx-community/modnet-webnn" \
  "config.json" \
  "preprocessor_config.json" \
  "quantize_config.json" \
  "onnx/model.onnx"

# --- BEN2 (高精度, fp16) ---
process_model "onnx-community/BEN2-ONNX" \
  "config.json" \
  "preprocessor_config.json" \
  "onnx/model_fp16.onnx"

echo ""
echo "✅ 完了: すべてのモデルを r2://${BUCKET} にアップロードしました"
