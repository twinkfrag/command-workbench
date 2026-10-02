# 開発ガイド

このリポジトリのルートを作業ディレクトリにします。必要なものは Desktop 版 VS Code 1.90.0 以降、Node.js 22 以降、npm（VSIX 作成時）です。`code` コマンドを PATH から利用できるようにしてください。以下は PowerShell の例です。

## ソース構成

| パス | 役割 |
| --- | --- |
| `src/extension.js` | 拡張機能の起動と VS Code API への登録 |
| `src/language/` | 引数のトークン化・解析 |
| `src/commands/` | プロファイル検証、実行ファイル解決、Job の投入 |
| `src/queue/` | Job のスナップショットと FIFO スケジューラー |
| `src/execution/` | Task API の `ProcessExecution` による実行 |
| `src/editor/` | ファイルドロップ・補完 |
| `src/view/` | キュー表示と Job 操作 |
| `syntaxes/` | TextMate の色分け定義 |
| `test/` | Node.js 組み込みテストランナーによるテスト |

JavaScript を直接読み込むため、トランスパイルやバンドルは不要です。拡張機能の実行時依存パッケージはありません。

## テスト

```powershell
node test/run.js
```

`npm test` でも同じテストを実行できます。テスト用の外部パッケージのインストールは不要です。VS Code API を使う部分はモックで検証しているため、エディターやターミナルの動作は実機でも確認します。

## Extension Development Host

```powershell
code --new-window --extensionDevelopmentPath="$PWD" .
```

開発用ウィンドウで `.argslist` を作成し、設定と実行を確認します。ソース変更後は開発用ウィンドウで `Developer: Reload Window` を実行してください。

確認用に Node.js の絶対パスをプロファイルへ登録すると、追加の CLI を用意せず引数や作業ディレクトリを確認できます。ターミナルで `node -p process.execPath` を実行してパスを取得します。

```json
{
  "commandWorkbench.commands": {
    "node": "C:\\Program Files\\nodejs\\node.exe"
  }
}
```

```text
@exec node
-e "console.log(process.cwd()); console.log(process.argv.slice(1)); console.error('stderr')"
"argument with spaces" "" "$HOME" "a|b"
```

手動確認の対象:

- 未保存の編集内容が保存なしで実行され、引数順・空文字・引用符内の空白・作業ディレクトリ・標準出力・標準エラーが保持される。
- 複数の `@exec` が逐次実行される。`-e "process.exit(7)"` を使ったステップの後は実行されず、Job が失敗になる。
- `-e "setTimeout(() => {}, 30000)"` を使って Job を複数投入し、FIFO・並列数の変更・待機取消・実行停止・元のスナップショットからの再実行を確認する。
- ファイルドロップ、選択範囲内へのドロップ、プロファイル・パス補完、コメント内の補完抑止、色分け、キュー表示を確認する。
- ワークスペースのない新規ファイルで、絶対 `@cwd` があれば実行でき、作業ディレクトリを決定できなければエラーになる。
- ffmpeg / ffprobe、および固定引数を持つプロファイルを使う変更では、それらの実行経路も確認する。

## VSIX のビルド

公式のパッケージ作成ツール `@vscode/vsce` を使用します。初回実行時は npm レジストリへのアクセスが必要です。実行時依存がないため `--no-dependencies` を指定します。

```powershell
node test/run.js
npx --yes --package @vscode/vsce@3 vsce ls --no-dependencies
npx --yes --package @vscode/vsce@3 vsce package --no-dependencies --githubBranch master --skip-license
```

`package.json` のバージョンに対応する `command-workbench-0.1.0.vsix` が生成されます。`vsce ls` で実行に必要なソース・マニフェスト・言語設定・文法・README が含まれることを確認します。テスト、開発ガイド、生成済み VSIX は `.vscodeignore` で配布物から除外します。

このリポジトリにはライセンスファイルがないため、上記のローカル検証用ビルドでは `--skip-license` を指定します。配布する場合は適用するライセンスと利用条件を決め、ライセンスファイル・マニフェストを整えてから、このフラグを外してください。

手順・オプションの詳細は [VS Code のパッケージ作成・公開ガイド](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#packaging-extensions) を参照してください。

## ローカル環境へのインストール

```powershell
code --install-extension ./command-workbench-0.1.0.vsix --force
code --list-extensions --show-versions
```

`--force` は同じバージョンの検証用 VSIX を上書きするために指定します。拡張機能ビューの「VSIX からのインストール」も利用できます。VS Code のウィンドウを再読み込みし、`command-workbench.command-workbench@0.1.0` が一覧にあることと、通常のウィンドウで上記の手動確認ができることを確認します。バージョン・publisher を変更した場合はファイル名と拡張機能 ID も変わります。

検証用拡張機能を削除する場合:

```powershell
code --uninstall-extension command-workbench.command-workbench
```
