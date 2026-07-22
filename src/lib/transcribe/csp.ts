// csp.ts — /transcribe に適用する追加 Content-Security-Policy
//
// なぜページ単位で meta を出すのか:
// - `public/_headers` はサイト全体に効くが、Cloudflare Pages でしか適用されない。
//   ローカルプレビュー（astro preview）と Playwright の E2E では効かないため、
//   「/transcribe だけ connect-src を self に絞る」ことを実際に検証できない。
// - meta の CSP はヘッダーの CSP と **両方が独立に適用される**（＝積集合）。
//   したがってここで絞れば、本番でも実効的に厳しい方が勝つ。
//
// 許可する追加通信は同一オリジンのみ:
//   - `/models/transcribe/**`（Cloudflare 経由で R2）
//   - `/vendor/onnx-wasm/**`（ONNX Runtime Web の WASM）
// 音声・文字起こしテキストの送信先は存在しない（計測 API も呼ばない）。

export const TRANSCRIBE_CSP = [
	"default-src 'self'",
	// ONNX Runtime の WASM 実行と、transformers.js が生成する WASM ローダ blob のために必要
	"script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	// <audio> の duration 取得に Object URL を使う
	"media-src 'self' blob:",
	"font-src 'self'",
	// ここが本丸。外部への送信経路を塞ぐ
	"connect-src 'self'",
	"worker-src 'self' blob:",
	"child-src 'self' blob:",
	"manifest-src 'self'",
	"base-uri 'self'",
	"form-action 'self'",
].join('; ');
