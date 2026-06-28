---
title: "ファビコン生成"
description: "1枚の画像から favicon.ico・各サイズPNG・apple-touch-icon・Android用アイコン・site.webmanifest をブラウザだけで一括生成。"
category: "開発ツール"
summary: "1枚の画像から favicon.ico や各サイズPNG、apple-touch-icon、PWA用マニフェストアイコンを一括生成。各種デバイスやブラウザに対応するファビコンセットが手軽に揃います。"
useCases:
  - "自作WebサイトやWebアプリケーションのファビコン（アイコン）を素早く用意したい"
  - "既存の企業ロゴやイラストからマルチサイズ内包の favicon.ico やスマホ用アイコンを出力したい"
  - "PWA（Progressive Web App）に必要な webmanifest と192px/512pxアイコンをまとめて一括作成したい"
howto:
  - "元となるロゴやアイコン画像（正方形・512px以上推奨）をアップロードします"
  - "背景色の有無やパディング、角丸などの表示スタイルを設定します"
  - "「生成」をクリックし、全サイズアイコンと site.webmanifest が同梱されたZIPファイルをダウンロードします"
faq:
  - q: "元画像の推奨サイズやフォーマットはありますか？"
    a: "512×512px以上の正方形画像（PNG/JPEG/WebP/SVG）を推奨します。高解像度の原本を使うことで縮小時も綺麗に生成されます。"
  - q: "どのようなファイルとコードが出力されますか？"
    a: "favicon.ico（16/32/48px内包）、apple-touch-icon.png（180px）、Android用アイコン（192/512px）、site.webmanifest および HTML記述用 `<link>` タグが出力されます。"
  - q: "PWA対応に必要な manifest.json や各種サイズのアイコン一式もまとめて生成されますか？"
    a: "はい。.ico ファイルに加え、192x192, 512x512, apple-touch-icon などの主要サイズセットをZIPで一括出力します。"
related:
  - "image-compress"
  - "color"
  - "ogp"
updated: 2026-06-28
keywords:
  - "ファビコン生成"
  - "favicon.ico"
  - "apple-touch-icon"
  - "PWAアイコン"
  - "webmanifest"
---
