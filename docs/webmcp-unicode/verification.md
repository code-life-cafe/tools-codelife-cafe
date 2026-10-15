

## Unicode変換 WebMCP（2026-10-15）

- Risk R3。ユーザー承認済みapproved-unicode-plan.mdをACとし、Codex実装・agy独立レビュー。base:116b26703f03d36b0fdb104bcf29f37ce93f6fd0。
- convert_unicode({text,action:encode|decode}) → {result}。最大20000コードポイント、成功JSON UTF-8 1MiB。UIと同じ空白前処理・既存純粋関数・固定日本語エラー。UI変更は登録/解除のみ。
- manifest:既存17定義のJSON内容をすべて維持し18定義へ。共通型/SW/依存/CI/Analyticsは未変更。consequentialHintは既存型にないため宣言へ追加せず、実ブラウザ表示ではfalseだった。
- build成功。lint成功（既存15warnings/1info、今回追加なし）。tsc --noEmit --pretty false --ignoreDeprecations 6.0成功。build後の全unit:1563/1563、関連PC/mobile E2E:78/78。初回の全unitはbuildと重なり中間dist参照で2件失敗したため、完成buildで全件再実行して成功。
- 上限20000→20001の一時mutationでschema/境界テスト2件が失敗し、必ず復元して12/12成功。生成manifestのmaxLength20000と実クライアント20001拒否も確認。
- 通信監視をfetch/XHR/beacon/WebSocketへ補完後、新Unicode E2E12/12と使い捨てPWA2/2成功。390px単独6/6成功。最終E2EではPC1280x900/mobile390x844をテスト内で明示。
- 実WebMCP:本番ページでは実装前の登録なしを確認。ローカル4397でネイティブdocument.modelContext登録を検出し、encode日本語😀→\u65e5\u672c\u8a9e\ud83d\ude00、decode\u3042\u{1F600}→あ😀、範囲外・不正action・20001コードポイントを拒否。20000絵文字encode成功。UI出力一致、別入力のMCP実行後もUI本文/方向/結果/URL/local/sessionStorage不変。モック実行とは別の証拠。
- 実ブラウザ1280px/390pxで横はみ出しなし、console errorなし。表示幅は復元。画像docs/webmcp-unicode/acceptance-desktop.png。
- SWを有効にした使い捨てcontextでページ/Unicode chunkをwarm cache→offline reload→通常UI encode/MCP decode成功。registrations0/caches[]/local0/session0を確認してcontext破棄。詳細pwa-local-acceptance.json。一括precache/R2配信や本番デプロイは今回確認していない。通常fixtureのSW無効E2Eとは別。
- agy初回:needs-attention。390pxをテスト内に明示して対応。既存unitファイル未変更の指摘は、必要な固定例が新unitに存在し既存純粋関数も未変更のためコード不具合としては不採用、集約意図を計画追記。PWA pendingの記録は完了結果へ更新。初回raw structured reportはagy-review-initial.json。最終差分の再レビューを実施する。修正ループ1/3、Production修正0。
- 元のD:/tools-codelife-cafeの未コミット変更は含めない。完了済みtext-diffのclean worktreeを新Unicodeブランチへ再利用したためcheckoutのパス名はwebmcp-text-diffのまま。
- Merge/Deployの承認は今回に含まれず、Draft PR/CIまで。GitHub正式Code/Security Review、必須CI、本番受入は別の証拠として扱う。
