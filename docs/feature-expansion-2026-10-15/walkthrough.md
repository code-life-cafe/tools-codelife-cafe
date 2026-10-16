# PDFテキスト抽出の検証記録

実施日: 2026-10-15（JST）。承認済み[実装計画](./implementation_plan.md)に基づく。ブランチ `codex/pdf-to-text`、base `d6a80f8d73399b183e6fc1243af3a9e0e13412cd`。Notionタスク指定なし。Risk Class: R3（信頼できないPDFの解析経路の追加）。Merge/Deployは対象外。

## 実装

`/pdf-to-text/` に文字レイヤーPDFのページ指定抽出を追加。日本語/英語、内部順/横書きの行整形、ページ見出し、編集、コピー、UTF-8 TXT保存に対応。OCRは行わず、文字なしページと全空を区別する。50MiB・100ページ・100万UTF-16コード単位・8MiBの出力上限を検証し、途中の結果を完成品として保存しない。

純粋ロジック・React UI・content・Astroページの4ファイル、catalog/README、共有render session、unit/E2E/合成fixtureを変更。共有common.tsのエラーコードへ1要素追加。既存PDFと同じページisland登録のため旧registryは変更不要。新しい依存・計測イベント・WebMCP・CI/Deploy設定・Constitutionの変更なし。

## 検証結果

| 検査 | 結果 |
| --- | --- |
| npm run lint | 成功。既存警告15件・info1件、エラーなし |
| npm run check | 成功。Astro型エラーなし、既存警告あり |
| npm run build | 成功。新規ページとOG生成、Pagesアセット上限検査成功 |
| 全体単体テスト（build後） | 1,652件すべて成功・skipなし |
| 対象単体テスト | 46件すべて成功 |
| PDF/検索/SEO E2E（Chromium＋Pixel 7エミュレーション） | 175件成功・13件既存skip。追加delivery2件は後述の最終再実行で両方成功（合計177成功・13skip） |
| 最後の幅欠損修正後の対象E2E | PDFテキスト抽出64件＋通常配信2件、計66件すべて成功（PC/モバイル）。共有描画を変更していないため既存PDF/検索の前回111件は再実行せず、全体は最新CIへ |
| 通常配信・SW E2Eの最終再実行 | 2件成功（PC/モバイルプロジェクト）。新規context・routeなし・SW許可で検証 |
| ネイティブの内蔵ブラウザ | 合成text-ja.pdfの3ページを抽出し、TXTを実保存。3,679バイト・1,423UTF-16単位・日本語・見出し3件・BOMなし・CRなしをファイル側で確認 |

対象E2Eは `tests/e2e/fixtures/base.ts` 経由。既定4321は別checkoutのため、本worktreeのdistを専用4351で配信し、一時Playwright設定だけで接続（コミット対象外）。全体E2EはGitHub Actionsで確認する。GitHub CIの結果はPR本文を参照。

### 主要な検証内容

- 日本語/英語3ページを生成時の文言から組み立てた期待値と完全比較。回転0/90/180/270、分割item、段組み/表/縦書き/ルビの合成PDFを検証。複雑な読み順は非保証。
- UTF-8・BOMなし・LFの保存と編集後の実クリップボード内容、ファイル名、空/混在ページの警告と全空時の保存不可。
- 50MiB・100ページ・100万コード単位・8MiBの境界。8MiBはunitで独立検証し、文字数制限が先に発火するため実運用で8MiBへ達するとは案内しない。巨大実PDFのメモリ耐性は未確認。
- 暗号化/破損/署名/フォーム拒否、隠し署名辞書、先頭/本文読込失敗、資産取得失敗からの復帰。
- キャンセル、遅い有効→有効・破損→有効・有効→空の差替え、設定/範囲変更時の古い結果破棄、再実行。
- HTML文字列をtextareaで扱い、埋込みJavaScript・リンクを実行しない。本文・ファイル名・ページ範囲を設定/URLへ残さない。375px/1440px、キーボード、状態通知を検証。
- 通常配信の各プロジェクトで369リクエスト、外部オリジン0。合成マーカーの通信・ログ・保存設定・URLへの漏洩なし。既存匿名 `/api/event` の送信は許可済みスキーマのみ（観測Beacon本文7件、tool_run3件）。Service Worker経由のPOST本文はPlaywrightのrequestに出ないことがあるため、実sendBeaconを呼ぶ観測ラッパーも使用（遮断/モック応答なし）。
- オンラインでページ・日本語CMap・Workerを通常の抽出経路で取得後、オフライン再読み込み・日本語の再抽出成功。オフライン同一オリジンレスポンスは各プロジェクト89〜90件、すべてSWから。初回未取得の資産や全ツールの一括キャッシュ成功は主張しない。
- トップページ等にPDF本体の直接初期ロード参照なし。PDF.js/Worker等の遅延ロードと同一オリジン配信を維持。

## レビューと修正

Claude Code Makerで初期実装。別セッションのClaude Codeとagy（Gemini 3.8 Flash）でProductionとテストを読み取り専用レビュー。主担当も差分と合成PDFの再現を確認した。修正セッションの途中でClaudeの利用上限に達したため、主担当が残りを引き継いだ。レビュアーの静的な「検証済み」という表現は、実行テスト成功の証拠とは扱わない。

| 指摘 | 主担当の判定・対応 |
| --- | --- |
| CRLF・末尾改行で上限内の文字列を早期拒否 | actionable defect/P2。整形後長さの下限で早期判定し、最終長を再検査。回帰unit追加 |
| 未参照署名辞書PDFが受入可能 | actionable defect/P2。既存PDF圧縮と同じbyte inspectionを再利用。signed-hiddenの拒否unit/E2E追加 |
| ファイル先頭readがtry外 | actionable defect/P2。先頭/本文の読込を捕捉し、日本語エラーと再選択を検証 |
| 通常配信のprivacy/SW証拠不足 | test inadequacy/P2。遮断なしの独立contextで通信とオフラインを追加検証 |
| 拡張漢字の間の不要な空白 | actionable defect/P2。𠮷/𠮟と英字隣接を再現。Unicode Han判定へ拡張。修正前unit失敗→修正後成功 |
| UserUnit2で隣接英単語に空白 | actionable defect/P2。表示座標に合わせ文字幅をスケール。修正前E2EでHello World→修正後HelloWorldを確認 |
| 幅情報欠損時の行整形 | actionable defect/P2。幅がnull/NaN/Infinityなら内部順へ戻す。unitで修正前失敗→修正後成功。PR修正ループ1/3 |
| ゼロ幅文字だけのページ | informational。元文字保持の仕様上、不可視文字を勝手に消さない |
| 8MiBの前に文字数上限へ達する | informational。追加の独立容量制限であり、8MiBまで入力可能とはしない |
| 傾斜/段組み等の行クラスタリング | documented limitation。完全な読み順復元は範囲外、内部順へ切替可能 |
| 共通validatePdfInputのテストが新unitにない | informational。既存の共通unitと新E2Eの入力境界で検証済み。重複テストを増やさない |
| contentとcatalogのrelated差・件数への疑問 | informational。新ツールは既存登録方式に従い、READMEは57→58。Production不具合の証拠なし |

agyの修正後再レビュー（895bf13b-a587-4712-8c81-4c20d76a5c7e）は具体的不具合の追加なし。Claude Code最終レビュー（527c3cc6-bd10-488d-a936-3d49bd18a6c3）で原findingを解消確認後、新たに幅欠損時のフォールバック不足を指摘。修正後の再レビューでは残るblockerなし。同じ最終差分をagyも再レビューし、具体的な残存欠陥なし（b10a0839-68a8-4541-a7a9-fc567f79bf43）。どちらも読み取り専用で、テスト結果は主担当の実行証拠と区別する。

## 途中の失敗と切り分け

- 初回の全体unit1件失敗は古いsmol-toml1.8.0（宣言^1.9.0）による行番号差だった。既存lockfileでnpm ci --ignore-scripts＋指定パッケージのrebuild後、smol-toml1.9.1/Astro7.3.8へ揃い全unit成功。package.json/lockfile差分なし。DLLロックのため今回起動した専用previewのみ終了して再試行した。
- ストリームのcancelをawaitすると完了済みWorkerで待ち続けるケースを初期E2Eで発見。cancel要求を待たない実装へ修正し、100万境界と再実行をE2Eで確認。
- 通常配信の初稿は全サイト一括キャッシュのUI完了待ちで2件失敗。対象ツールのACは必要資産取得後のオフラインであるため、通常の日本語抽出で資産取得後にオフラインへ切り替える検証へ変更。続いてSW経由requestのPOST本文が空でJSON検査に失敗したため、実送信を維持したBeacon本文観測を追加。匿名イベントを禁止する誤った前提も既存Allowlist照合へ修正。最終2件成功。PWA/計測基盤のProduction変更なし。
- 内蔵ブラウザの標準runtime接続はEPERM。CUAの既存内蔵ブラウザ経路で確認。保存通知待ちに長い遅延があり、ツール処理時間とは区別。コピー成功表示は出たが内蔵ブラウザのclipboard readbackは0文字で未確認（Playwrightの実clipboard検証は成功）。

## 未確認と対象外

Firefox/WebKit、モバイル実機、全形式の実業務PDF、極大メモリ耐性、全サイト一括PWAキャッシュ、本番公開後の実動作は未確認。OCR・AI送信・署名検証・解除・Markdown構造復元は非対応。入力や結果を自動収集する計測は追加しない。

D:/tools-codelife-cafeの既存の未コミット変更（AGENTS/CLAUDE/README/catalog/cipher/utility/video等）は一切stage/commitしない。本worktreeの計画スコープのみをDraft PRへ含める。
