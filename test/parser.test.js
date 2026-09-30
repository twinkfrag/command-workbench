const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { parseArgsList } = require("../src/language/parser");

const commands = {
  ffmpeg: "ffmpeg.exe",
  converter: {
    executable: "python.exe",
    args: ["C:\\tools\\convert.py"],
  },
};

test("改行と行内whitespaceを同じargv separatorとして扱う", () => {
  const parsed = parseArgsList(
    '@exec ffmpeg\n-map\n0:v -map 0:a?\n-c copy\n"output file.mkv"',
    { commands },
  );

  assert.deepEqual(parsed.steps[0].argv, ["-map", "0:v", "-map", "0:a?", "-c", "copy", "output file.mkv"]);
});

test("固定profile argsをdocument argsより前に置く", () => {
  const parsed = parseArgsList('@exec converter\n--input "input file.dat"', { commands });

  assert.equal(parsed.steps[0].executable, "python.exe");
  assert.deepEqual(parsed.steps[0].argv, ["C:\\tools\\convert.py", "--input", "input file.dat"]);
});

test("settings側の配列を変更してもparse済みargvは変わらない", () => {
  const fixedArgs = ["script.py"];
  const parsed = parseArgsList("@exec python\ninput.dat", {
    commands: { python: { executable: "python.exe", args: fixedArgs } },
  });

  fixedArgs[0] = "changed.py";
  assert.deepEqual(parsed.steps[0].argv, ["script.py", "input.dat"]);
});

test("行頭commentを無視し、通常argument内の#を保持する", () => {
  const parsed = parseArgsList('  # ignored\n@exec ffmpeg\nfoo # bar\n"file#name.mkv"', { commands });

  assert.deepEqual(parsed.steps[0].argv, ["foo", "#", "bar", "file#name.mkv"]);
});

test("改行はstep境界ではなく、@execだけが新しいstepを開始する", () => {
  const parsed = parseArgsList('@exec ffmpeg\n-a\nb\n@exec converter\nx', { commands });

  assert.equal(parsed.steps.length, 2);
  assert.deepEqual(parsed.steps[0].argv, ["-a", "b"]);
  assert.deepEqual(parsed.steps[1].argv, ["C:\\tools\\convert.py", "x"]);
});

test("@cwdを解決して後続stepへ継承し、既存stepのcwdを変えない", () => {
  const base = path.resolve("work");
  const parsed = parseArgsList(
    '@exec ffmpeg\na\n@cwd "sub folder"\n@exec ffmpeg\nb\n@cwd child\n@exec ffmpeg\nc',
    { commands, defaultCwd: base },
  );

  assert.equal(parsed.steps[0].cwd, base);
  assert.equal(parsed.steps[1].cwd, path.resolve(base, "sub folder"));
  assert.equal(parsed.steps[2].cwd, path.resolve(base, "sub folder", "child"));
});

test("directiveの引用符内にある改行と@文字列はargumentとして保持する", () => {
  const parsed = parseArgsList('@exec ffmpeg\n"first\n@exec is text\nlast"', { commands });

  assert.deepEqual(parsed.steps[0].argv, ["first\n@exec is text\nlast"]);
});

test("未登録profile、未知directive、@exec前のargumentを拒否する", () => {
  assert.throws(() => parseArgsList("@exec missing", { commands }), { code: "UNKNOWN_COMMAND_PROFILE" });
  assert.throws(() => parseArgsList("@other value", { commands }), { code: "UNKNOWN_DIRECTIVE" });
  assert.throws(() => parseArgsList("argument\n@exec ffmpeg", { commands }), { code: "ARGUMENT_BEFORE_EXEC" });
});

test("不正なdirectiveと空documentを拒否する", () => {
  assert.throws(() => parseArgsList("@exec ffmpeg extra", { commands }), { code: "INVALID_EXEC_DIRECTIVE" });
  assert.throws(() => parseArgsList('@cwd "path with spaces"', { commands, defaultCwd: process.cwd() }), { code: "NO_STEPS" });
  assert.throws(() => parseArgsList("@cwd subdir\n@exec ffmpeg", { commands }), { code: "UNRESOLVED_CWD" });
});

test("返すstepとargv配列を凍結する", () => {
  const parsed = parseArgsList("@exec ffmpeg\n-a", { commands });

  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.steps), true);
  assert.equal(Object.isFrozen(parsed.steps[0]), true);
  assert.equal(Object.isFrozen(parsed.steps[0].argv), true);
});
