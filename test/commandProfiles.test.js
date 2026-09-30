const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeCommandProfiles } = require("../src/commands/commandProfiles");

test("executable shorthandとstructured profileを正規化する", () => {
  const profiles = normalizeCommandProfiles({
    ffmpeg: "ffmpeg.exe",
    converter: {
      executable: "python.exe",
      args: ["C:\\tools\\convert.py"],
    },
  });

  assert.deepEqual(profiles.get("ffmpeg"), {
    alias: "ffmpeg",
    executable: "ffmpeg.exe",
    args: [],
  });
  assert.deepEqual(profiles.get("converter"), {
    alias: "converter",
    executable: "python.exe",
    args: ["C:\\tools\\convert.py"],
  });
});

test("profileのexecutableとargsの形式を検証する", () => {
  assert.throws(() => normalizeCommandProfiles({ tool: { executable: "tool.exe", args: "-x" } }), {
    code: "INVALID_COMMAND_PROFILE",
  });
  assert.throws(() => normalizeCommandProfiles({ tool: { executable: "tool.exe", command: "tool.exe -x" } }), {
    code: "INVALID_COMMAND_PROFILE",
  });
  assert.throws(() => normalizeCommandProfiles([]), { code: "INVALID_COMMAND_PROFILES" });
  assert.throws(() => normalizeCommandProfiles(null), { code: "INVALID_COMMAND_PROFILES" });
});

test("ユーザーがprofileに明示したshell executableもprofileとして保持する", () => {
  const profiles = normalizeCommandProfiles({
    shell: { executable: "powershell.exe", args: ["-File", "C:\\tools\\job.ps1"] },
  });

  assert.equal(profiles.get("shell").executable, "powershell.exe");
  assert.deepEqual(profiles.get("shell").args, ["-File", "C:\\tools\\job.ps1"]);
});
