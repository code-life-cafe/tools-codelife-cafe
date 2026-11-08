// /upscale が使う onnxruntime-web（トップレベルに pin した版）の wasm 配信元。
// package.json の onnxruntime-web と一致させる（build時に scripts/lib/upscale-ort-assets.mjs が照合する）。
// bg-remove と同様 cdn.jsdelivr.net を使用（CSP script-src/connect-src で許可済み）。
export const UPSCALE_ORT_VERSION = '1.31.1';
export const UPSCALE_ORT_WASM_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${UPSCALE_ORT_VERSION}/dist/`;
