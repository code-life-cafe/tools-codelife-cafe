---
title: "YAML ⇔ JSON ⇔ TOML 変換ツール"
description: "YAML・JSON・TOMLを相互変換。構文エラーは行・列付きの日本語で表示。インデント幅・キーソートにも対応。データは外部送信なし。"
category: "開発ツール"
summary: "Kubernetes/GitHub ActionsのYAML、Cargo.toml/pyproject.tomlのTOML、APIレスポンスのJSONを、ブラウザ内でそのまま相互変換。構文エラーは行・列付きの日本語で表示し、インデント幅・キーソートも指定できます。"
useCases:
  - "Kubernetes ManifestやGitHub ActionsのYAMLを、プログラムで扱いやすいJSONに変換したい"
  - "Cargo.tomlやpyproject.tomlのTOML設定を、他の形式と見比べたりJSONへ変換したい"
  - "APIレスポンスのJSONを、設定ファイル用にYAMLへ変換したい"
howto:
  - "From（変換元）とTo（変換先）の形式をYAML/JSON/TOMLから選択します"
  - "左の入力欄にテキストを貼り付けます（サンプルデータも選択できます）"
  - "右の出力欄に変換結果がリアルタイムで表示されます。インデント幅やキーソートも切り替えられます"
faq:
  - q: "YAMLのコメントは変換後も残りますか？"
    a: "いいえ。コメントは変換の過程で失われます。コメントを残したい場合は元のYAMLファイルを別途保管してください。"
  - q: "入力したデータはサーバーに送信されますか？"
    a: "送信しません。変換処理はすべてブラウザ内（クライアントサイド）で完結し、入力内容が外部に送信されることはありません。"
  - q: "JSONの配列（ルート要素が配列）はTOMLに変換できますか？"
    a: "できません。TOMLはルート要素にオブジェクト（テーブル）が必要なため、配列を自動的にラップすることはせず、エラーとして表示します。"
  - q: "null値を含むデータはTOMLに変換できますか？"
    a: "できません。TOMLにはnull型が存在しないため、null値を含むキーをパス付きのエラーとして表示します。JSON⇔YAML間ではnullはそのまま保持されます。"
  - q: "TOMLの日時型は変換後も同じ型で保たれますか？"
    a: "JSON・YAMLへ変換するとISO 8601形式の文字列になります。TOMLに戻しても日時型としては復元されないため、往復では型情報が失われる点にご注意ください。"
related:
  - "json-formatter"
  - "json-csv"
updated: 2026-07-10
keywords:
  - "YAML"
  - "JSON"
  - "TOML"
  - "変換"
  - "Kubernetes"
  - "GitHub Actions"
  - "Cargo.toml"
---
