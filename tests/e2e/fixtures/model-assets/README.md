# 固定モデル設定のテスト用実体

MODNetの固定revision `6af52070d14deafc5e55ce6cc4d752a322cdff76` に含まれるconfig、preprocessor_config、quantize_configの元バイト列。内容を改変せずハッシュを照合するため、拡張子を.fixtureとしている。新モデルや模擬設定を生成したものではない。

取得元: [onnx-community/modnet-webnn](https://huggingface.co/onnx-community/modnet-webnn/tree/6af52070d14deafc5e55ce6cc4d752a322cdff76) / モデルカードのライセンス表記: Apache-2.0。

通常CIの改変・欠落テストを大容量モデルの取得なしで実行するために使用。正常推論をこれらの設定だけで証明するものではない。
