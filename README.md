# Command Workbench

`.argslist` の引数列をVS Codeの通常のテキストエディターで編集し、現在のbufferをimmutableなJobとして実行する拡張機能です。通常部分は改行を含むwhitespace区切りのargv列として扱い、shell scriptとしては解釈しません。

## 現在の実装

- `.argslist` のlanguage registrationと行コメント設定
- `@exec` / `@cwd`、whitespace・double quote・行頭commentを扱うparser
- `commandWorkbench.commands` の実行profile検証。executable shorthandと固定 `args` を持つprofileに対応
- `Ctrl+Enter` による未保存bufferのJob化と、Task API `ProcessExecution` を使った複数Stepの逐次実行
- FIFO Job Queueと `commandWorkbench.maxParallelJobs` によるJob単位の並列実行
- `DocumentDropEditProvider` によるfile path挿入、Command Profile / path completion、comment・directive・quoted stringのsyntax highlighting
- tokenizer、parser、profile検証、Job snapshot、Queue、実行制御、Editor providerのunit test

Queue UIは未実装です。

ファイルD&DにはVS Code設定 `editor.dropIntoEditor.enabled` が必要です。OSからEditorへdropする場合はShiftを押しながら操作する必要があることがあります。D&DはCommand optionを追加せず、quoted full pathだけを挿入します。

## 形式の例

```text
# コメント
@cwd "D:\work"
@exec ffmpeg
-ss 10 -i "input file.mkv"
-c copy
"output.mkv"
```

`@exec` はCommand Profileのaliasを指定します。空白や改行は通常argumentの区切りです。`@exec` だけがStep境界になります。

## Command Profile設定例

```json
{
  "commandWorkbench.commands": {
    "ffmpeg": "ffmpeg.exe",
    "converter": {
      "executable": "python.exe",
      "args": ["C:\\tools\\convert.py"]
    }
  }
}
```

profileの固定 `args` は `.argslist` のargumentより先に渡す設計です。

`commandWorkbench.maxParallelJobs` は既定値1です。値を増やすと空いたslot分のWaiting Jobを開始し、値を減らしても実行中Jobは停止しません。

## 開発

Node.jsの組み込みtest runnerを使います。外部packageのインストールは不要です。

```powershell
node test/run.js
```

VS Code Extension Development Hostで開く場合は、product directoryで次を実行します。

```powershell
code --extensionDevelopmentPath="$PWD"
```
