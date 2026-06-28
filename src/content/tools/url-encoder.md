---
title: "URLエンコード / デコード"
description: "「URLに日本語が入って文字化け…」を一発解決。クエリパラメータもパスも安全にエンコード/デコード。コンポーネント単位とフルURLの両モード対応。"
category: "エンコード/デコード"
summary: "日本語が含まれるURLをシェアした際の文字化けや、UTMパラメータ・APIクエリの送信エラーを防止。Component単位とFull URL単位の適切なエンコード/デコードを選択できる。"
useCases:
  - "日本語を含むURLをシェアしたら文字化けした"
  - "Google AnalyticsのUTMパラメータに日本語キャンペーン名を入れたい"
  - "APIリクエスト用にクエリパラメータを安全にエンコードしたい"
howto:
  - "URLまたはパラメータを入力"
  - "モード選択: 「コンポーネント単位」または「フルURL」"
  - "「エンコード」または「デコード」をクリック"
faq:
  - q: "encodeURI と encodeURIComponent の違いは？"
    a: "encodeURI はURL全体用（:// 等は維持）、encodeURIComponent はパラメータ値用（より厳密にエンコード）。本ツールでは両モードを選択できます。"
  - q: "デコードに失敗する文字列があるのはなぜ？"
    a: "不正な % シーケンス（例: %ZZ）はデコードできません。エラー表示されます。"
  - q: "スペースは %20 と + どちらになる？"
    a: "encodeURIComponent では %20。フォームデータ形式（+）が必要な場合は別途変換してください。"
related:
  - "base64"
  - "unicode-converter"
updated: 2026-06-28
keywords:
  - "URLエンコード"
  - "URLデコード"
  - "encodeURIComponent"
  - "encodeURI"
  - "文字化け"
---
