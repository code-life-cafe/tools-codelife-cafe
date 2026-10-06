# 依存脆弱性の差分ゲート

2026-10-06のユーザー承認（#411をマージ → 滞留PRをmain更新 → 差分監査を導入）に基づく実装。
Risk Class: R3。CIの監査判定を変更する。権限追加はデプロイ比較元のActions履歴読取のみ。

- 既存lint/e2e/deployのSecurity auditを共通スクリプトへ変更。新しいworkflowは追加しない。
- PRはbase SHAとテスト対象merge commit、mainのlintはpush前SHAと比較。
- デプロイとその前段E2Eは、同じ直前の正常deploy workflowのSHAと比較。production deploymentを直列化する。
- 全重大度で新規アドバイザリ、解決バージョン・依存配置・dev/optional区分の変更、重大度増加を停止。
- 既存分を含む監査JSONと差分をartifactに保存する。APIエラー、欠損、未知形式、比較元不明、非祖先は停止。
- lint、型チェック、build、unit、E2E、独立レビューの条件は維持する。
- unitで同件数の別脆弱性、既存分、削減、悪化、API異常を検証。ローカル実監査とCIで確認。
