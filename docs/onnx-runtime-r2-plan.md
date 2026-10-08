# ONNX runtimeの同一オリジンR2配信（R3）

直接依頼されたR2案をCodexで実装する。Claudeへの外部送信は行わない。既存codelife-models/TRANSCRIBE_MODELSを再利用し、認証・権限・CSP・契約を変更しない。

- manifestのversion/hashに限定したruntime GET/HEADルートを追加。未知パス、R2欠落・障害・size不一致はno-storeで失敗し、外部へフォールバックしない。
- Transformersが解決するORTだけのWASM asset URLをbuild時に既存vendor URLへ固定。Pages出力のmanifest runtimeを除外し、他のWASMは維持する。
- 最終Pages出力の全ファイルを25MiB上限で検査。runtimeの明示precacheとruntime cache-firstを維持。
- 公開runtimeをhash付き専用R2キーへ配置する運用を追加。既存内容を変更せず、公開前にGET/HEAD、hash、MIME、cacheを確認。
- build/unit、実WASM/WebGPU推論、Safari側ロード、外部通信遮断、cold/warm cache・SW、欠落時の安全な失敗を検証。未実施を成功扱いにしない。
- draft PRと同SHAのCI・独立レビューを待ち、Makerの自己承認を行わない。新規有料契約・権限拡大は行わない。
