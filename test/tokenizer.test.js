const assert = require("node:assert/strict");
const test = require("node:test");
const { tokenizeArguments } = require("../src/language/tokenizer");

test("空白・改行で分割し、引用符内の空白とWindows pathを保持する", () => {
  const tokens = tokenizeArguments('-ss 10\r\n-i "D:\\foo bar\\input.mkv"\t""');

  assert.deepEqual(tokens.map((token) => token.value), [
    "-ss",
    "10",
    "-i",
    "D:\\foo bar\\input.mkv",
    "",
  ]);
});

test("quote外の記号や環境変数らしい文字列を展開しない", () => {
  const tokens = tokenizeArguments("one | two && echo $HOME %VAR% $env:VAR");

  assert.deepEqual(tokens.map((token) => token.value), [
    "one",
    "|",
    "two",
    "&&",
    "echo",
    "$HOME",
    "%VAR%",
    "$env:VAR",
  ]);
});

test("CR単独もargument separatorとして扱う", () => {
  const tokens = tokenizeArguments("first\rsecond");

  assert.deepEqual(tokens.map((token) => token.value), ["first", "second"]);
});

test("未閉じdouble quoteの位置を返す", () => {
  assert.throws(
    () => tokenizeArguments('-i\r\n"unfinished', { startLine: 1 }),
    (error) => error.code === "UNCLOSED_QUOTE" && error.line === 2 && error.column === 1,
  );
});
