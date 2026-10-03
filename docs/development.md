# 開発ガイド

このリポジトリのルートを作業ディレクトリにします。必要なものは Desktop 版 VS Code 1.90.0 以降、Node.js 22 以降、npm（VSIX 作成時）です。`code` コマンドを PATH から利用できるようにしてください。以下は PowerShell の例です。

## ソース構成

| パス | 役割 |
| --- | --- |
| `src/extension.js` | 拡張機能の起動と VS Code API への登録 |
| `src/language/` | 引数のトークン化・解析 |
| `src/commands/` | プロファイル検証、実行ファイル解決、Job の投入 |
| `src/queue/` | Job のスナップショットと FIFO スケジューラー |
| `src/execution/` | Job ごとの親プロセス、子の逐次実行、キューへの進捗・結果通知 |
| `src/editor/` | ファイルドロップ・補完 |
| `src/view/` | キュー表示と Job 操作 |
| `syntaxes/` | TextMate の色分け定義 |
| `test/` | Node.js 組み込みテストランナーによるテスト |

JavaScript を直接読み込むため、トランスパイルやバンドルは不要です。拡張機能の実行時依存パッケージはありません。

実行は1 Job に1つの `ProcessExecution` タスクを作ります。Windows では標準の Windows PowerShell 5.1 と .NET の `ProcessStartInfo`、それ以外では VS Code 同梱の Node.js ランタイムと `spawn()` を使います。Windows PowerShell は `-NoProfile -ExecutionPolicy Bypass -File` で配布した実行ホストを起動します。組織のポリシーでスクリプト実行を禁止している環境では起動できない場合があります。対象コマンドはシェル構文として評価せず、実行ファイルと引数を直接渡します。Windows の引数は空文字・引用符・末尾のバックスラッシュを保持するよう Windows の argv 規則で引用します。

親は終了結果をローカル IPC でキューへ通知してから Enter を待ちます。Task 自体の終了を Job の完了として扱うとキューが止まるため、この2つの寿命を分けています。IPC は Windows の名前付きパイプ、他 OS の専用一時ディレクトリ内の Unix ソケットを使い、完了・失敗・取消で解放します。実行中の Terminate は Task API で親と子を停止します。

フォルダーもワークスペースファイルも開いていないウィンドウでは、親の初期ディレクトリにユーザーホームを使います。VS Code が空のウィンドウでホーム以外からのターミナル起動を拒否するためです。対象の子プロセスには、各 Step のスナップショットにある cwd を直接指定するので、`@cwd`・保存済みファイルの親・`defaultCwd` の意味は変わりません。

子の終了コードは IPC で通知し、Enter 入力後の親は終了コード0で終了します。子の失敗結果はキューに保持したまま、VS Code による追加のタスクエラー表示やキー入力待ちを避け、`presentationOptions.close` でターミナルを閉じます。

タスク開始の PID から対応するターミナルを識別し、ステップ開始・終了時に `sendText("", false)` を呼びます。文字や Enter は送らず、VS Code の子プロセス検出の更新を促します。公開 API で検出フラグを直接変更せず、子の終了後も親を生かして検出できる状態を保ちます。最小対応版と各 OS で終了確認も実機確認してください。

## テスト

```powershell
node test/run.js
```

`npm test` でも同じテストを実行できます。テスト用の外部パッケージのインストールは不要です。実行ホストのテストでは実際の子プロセスを起動し、引数・作業ディレクトリ・環境・結果通知・入力待ちを検証します。VS Code API はモックのため、エディターやターミナルの動作は実機でも確認します。

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
- フォルダーなしで保存済みファイルを開いた場合と `defaultCwd` を設定した新規ファイルでも、対象プロセスの作業ディレクトリを確認する。
- PowerShell の `-File` プロファイルを登録し、スクリプトに `"encode complete"` が1つの引数として届くことを確認する。`-Command` は後続もシェルコードとして再解析するため、argv の保持と区別する。
- ffmpeg / ffprobe、および固定引数を持つプロファイルを使う変更では、それらの実行経路も確認する。
- `terminal.integrated.confirmOnExit: "hasChildProcesses"` で長時間のジョブ実行中にウィンドウを閉じ、終了確認と取消を確認する。正常終了後は完了・Enter の案内とキューの Completed を確認し、子プロセス検出の更新後にウィンドウを確認なしで閉じられることを確認する。
- 完了ターミナルを残して次の Job が開始すること、失敗時も結果表示と Enter 待ちになること、文字キーでは閉じず Enter で閉じること、Terminate で子や孫のプロセスが残らないことを確認する。

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
