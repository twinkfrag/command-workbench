# Command Workbench

`.argslist` の引数列をVS Codeの通常のテキストエディターで編集し、将来は現在のbufferをJobとして実行・Queue投入する拡張機能です。通常部分は改行を含むwhitespace区切りのargv列として扱い、shell scriptとしては解釈しません。

## 現在の実装

- `.argslist` のlanguage registrationと行コメント設定
- `@exec` / `@cwd`、whitespace・double quote・行頭commentを扱うparser
- `commandWorkbench.commands` の実行profile検証。executable shorthandと固定 `args` を持つprofileに対応
- tokenizer、parser、profile検証のunit test

Job実行、Queue、Editor補完、D&D、Queue UIは未実装です。

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

## 開発

Node.jsの組み込みtest runnerを使います。外部packageのインストールは不要です。

```powershell
node test/run.js
```

VS Code Extension Development Hostで開く場合は、product directoryで次を実行します。

```powershell
code --extensionDevelopmentPath="$PWD"
```
