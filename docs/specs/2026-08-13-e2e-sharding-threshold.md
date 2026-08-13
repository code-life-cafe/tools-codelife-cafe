# E2E実行時間の閾値設計とシャーディング導入方針

- 日付: 2026-08-13
- ステータス: 承認済み（Notionタスク「E2E実行時間の閾値設計（8分超でシャーディング導入をトリガー）」）

## 背景・課題

2026-07-03 時点の実測値: 680テスト / 4ワーカー / Playwright実行4.6分、ジョブ全体約5分36秒
（668 passed / 11 skipped / 1 flaky）。現状は健全域だが上限に近い。

PR #204（main push時のE2E実行追加）のマージにより CI 消費が実質倍増するため、
実行時間が増加し続けた場合の判断基準を先に固定しておく。ツール数・テスト数は
今後も増加する見込みであり、閾値と導入手順を事前に文書化することで、
実際に遅くなった時点で都度議論する手戻りを避ける。

## 決定事項

1. **閾値**: `.github/workflows/e2e.yml` の `npx playwright test` ステップ（Playwright本体の実行時間。
   依存関係インストールやビルドを除く）が **8分を超えた場合**、シャーディング導入検討の
   明示的なトリガーとする。
2. **導入時の分割数**: 2〜4分割。初回導入は2分割から開始し、閾値超過が解消しない場合は
   3〜4分割へ段階的に増やす。
3. **レポート統合**: 各shardは `--reporter=blob` でレポートを出力し、全shard完了後に
   `npx playwright merge-reports` で単一のHTMLレポートへ統合する（分割してもPRの
   Playwrightレポートは従来どおり1つのartifactとして参照できる状態を維持する）。

## 実行時間の測定方法

以下のいずれかで、閾値（8分）に対する現在地を確認する。

- **基本（CI実測）**: GitHub Actionsの `E2E Tests` ワークフロー内、`e2e` ジョブの
  `npx playwright test` ステップの所要時間をActions UIの各ステップ実行時間表示で確認する。
- **補助（Playwright自身のサマリー）**: Playwrightはテスト完了時にターミナルへ
  `68 passed (4.6m)` のような合計実行時間を出力する。CIログの当該行でも概算できる。
- **ローカル計測**: `time npx playwright test`（事前に `npm run build && npm run preview` が必要）。
- **定点観測**: mainブランチへのマージ後に実行される `E2E Tests` ワークフローの実行時間を
  基準値とし、閾値超過が複数回連続した場合にシャーディング導入を判断する
  （単発の外れ値・flakyによる再試行は判断材料に含めない）。

## シャーディング導入手順（閾値到達時）

閾値に到達した場合、以下の手順で `.github/workflows/e2e.yml` を改修する。

1. `e2e` ジョブを `strategy.matrix` で2〜4分割し、各shardが担当範囲のみ実行するようにする。

   ```yaml
   jobs:
     e2e:
       strategy:
         fail-fast: false
         matrix:
           shardIndex: [1, 2]
           shardTotal: [2]
       steps:
         # ...(checkout / setup-node / install / build は共通)
         - name: Run Playwright tests (shard)
           run: npx playwright test --shard=${{ matrix.shardIndex }}/${{ matrix.shardTotal }} --reporter=blob
         - uses: actions/upload-artifact@...
           if: ${{ !cancelled() }}
           with:
             name: blob-report-${{ matrix.shardIndex }}
             path: blob-report
             retention-days: 1
   ```

2. 全shard完了後に依存する `merge-reports` ジョブを追加し、`actions/download-artifact` で
   各shardの `blob-report-*` を集約したのち、`npx playwright merge-reports --reporter=html
   ./all-blob-reports` でHTMLレポートへ統合する。

   ```yaml
     merge-reports:
       needs: [e2e]
       if: ${{ !cancelled() }}
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@...
         - uses: actions/download-artifact@...
           with:
             path: all-blob-reports
             pattern: blob-report-*
             merge-multiple: true
         - run: npx playwright merge-reports --reporter=html ./all-blob-reports
         - uses: actions/upload-artifact@...
           with:
             name: playwright-report
             path: playwright-report/
             retention-days: 14
   ```

3. `deploy.yml` から `workflow_call` で呼び出している既存の連携は維持する
   （matrix化してもジョブ名 `e2e` を維持し、依存ジョブ側の待ち合わせを壊さないよう
   `merge-reports` の完了をデプロイゲートの実体として扱う）。
4. 分割数はテストスイートの成長に応じて見直す。導入直後に8分を再度超えるようであれば
   3〜4分割へ増やす。

## 将来の選択肢（閾値到達時に別途検討）

- PR時: 変更ツール＋横断スモークの二層実行、mainプッシュ時: 全件実行という差分実行方式
- 41ツール共通パターンのパラメタライズ化によるテストコード自体の保守負荷低減

## スコープ外（本ドキュメント作成時点）

- シャーディングの実装（`.github/workflows/e2e.yml` へのmatrix追加）そのもの
- ジョブサマリーへの実行時間の自動出力（任意項目。閾値到達時の実装候補として別タスク化）

## 参照

- Notionタスク: E2E実行時間の閾値設計（8分超でシャーディング導入をトリガー）
- 実測データ出典: 2026-07-04 E2Eジョブログ分析（job-logs.txt / e2e run 2026-07-03T15:09Z）
- 関連PR: #204（main push時のE2E実行追加）
- 関連ワークフロー: `.github/workflows/e2e.yml`, `.github/workflows/deploy.yml`
