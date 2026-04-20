# BitwigPlaybackUtility

Bitwig Studio用のコントローラースクリプトです。再生開始時に8拍のカウントインを行い、マスターボリュームをフェードインします。

## 機能

- 再生ボタンを押すと同時にマスターボリュームをミュート
- メトロノームで8拍カウントイン
- 8拍かけてマスターボリュームをフェードイン
- カウントイン完了後、メトロノームを自動でオフ
- ツールバーポップアップからカウントイン機能のON/OFFを切り替え可能

## インストール

1. このフォルダを Bitwig Studio のコントローラースクリプトディレクトリに配置します
   - macOS: `~/Documents/Bitwig Studio/Controller Scripts/`
2. Bitwig Studio を起動し、**Settings > Controllers** を開きます
3. `Add controller` から `Custom > BitwigPlaybackUtility` を選択します

## 使い方

インストール後、再生ボタンを押すだけで自動的にカウントインが始まります。

### カウントインのON/OFF

ツールバーのコントローラーアイコンをクリックしてポップアップを開き、**Count-in (8 beats)** を `ON` / `OFF` で切り替えます。

- **ON → OFF 切り替え時**: メトロノームがONの場合は自動でOFFになります
- **OFF → ON 切り替え時**: 停止中であればメトロノームが自動でONになります（再生中は変更しません）

## 動作環境

- Bitwig Studio 5.x
- Controller API 19
