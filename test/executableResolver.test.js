const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { resolveExecutable } = require("../src/commands/executableResolver");

test("absolute executable pathをreal pathへ解決する", () => {
  const result = resolveExecutable(process.execPath, { cwd: process.cwd() });

  assert.equal(result.resolved, true);
  assert.equal(result.executablePath, require("node:fs").realpathSync.native(process.execPath));
});

test("PATH上のexecutable名をsubmit時点のPATHから解決する", () => {
  const executableName = path.basename(process.execPath);
  const environment = {
    PATH: path.dirname(process.execPath),
    PATHEXT: process.env.PATHEXT,
  };
  const result = resolveExecutable(executableName, { environment, platform: process.platform });

  assert.equal(result.resolved, true);
  assert.equal(result.executablePath, require("node:fs").realpathSync.native(process.execPath));
});

test("未解決のPATH名にはPATH環境のsnapshotを保持する", () => {
  const pathValue = `missing-${Date.now()}`;
  const result = resolveExecutable("command-workbench-not-installed", {
    environment: { PATH: pathValue, PATHEXT: ".EXE" },
    platform: "win32",
    cwd: "C:\\work",
  });

  assert.equal(result.resolved, false);
  assert.equal(result.executablePath, "command-workbench-not-installed");
  assert.deepEqual(result.env, { PATH: pathValue, PATHEXT: ".EXE" });
});

test("relative executable pathをcwd基準のabsolute pathにする", () => {
  const result = resolveExecutable("tools\\convert.exe", {
    environment: { PATH: "" },
    platform: "win32",
    cwd: "D:\\work",
  });

  assert.equal(result.executablePath, "D:\\work\\tools\\convert.exe");
  assert.equal(result.resolved, false);
});
