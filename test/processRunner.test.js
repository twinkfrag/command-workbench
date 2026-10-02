const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const { runJob } = require("../src/execution/processRunner");

function fakeVscode({ helper, execute } = {}) {
  const processListeners = new Set();
  const taskListeners = new Set();
  const startListeners = new Set();
  const terminals = [];
  const executions = [];
  const tasks = [];
  class ProcessExecution {
    constructor(process, args, options) { Object.assign(this, { process, args, options }); }
  }
  class Task {
    constructor(definition, scope, name, source, execution) {
      Object.assign(this, { definition, scope, name, source, execution });
      tasks.push(this);
    }
  }
  const finish = (execution, code) => {
    execution.ended = true;
    for (const listener of [...processListeners]) listener({ execution, exitCode: code });
    for (const listener of [...taskListeners]) listener({ execution });
  };
  const vscode = {
    TaskScope: { Workspace: 2 }, TaskRevealKind: { Always: 1 }, TaskPanelKind: { Dedicated: 2 },
    ProcessExecution, Task, capturedTasks: tasks, executions,
    listenerCount: () => processListeners.size + taskListeners.size + startListeners.size,
    window: { terminals },
    tasks: {
      get taskExecutions() { return executions.filter((item) => !item.ended); },
      onDidEndTaskProcess(listener) {
        processListeners.add(listener); return { dispose: () => processListeners.delete(listener) };
      },
      onDidEndTask(listener) {
        taskListeners.add(listener); return { dispose: () => taskListeners.delete(listener) };
      },
      onDidStartTaskProcess(listener) {
        startListeners.add(listener); return { dispose: () => startListeners.delete(listener) };
      },
      executeTask(task) {
        if (execute) return execute(task, finish);
        const launch = task.execution;
        const child = helper === "node"
          ? spawn(process.execPath, [path.join(__dirname, "../src/execution/jobHost.js"), launch.args.at(-1)],
            { cwd: launch.options.cwd, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } })
          : spawn(launch.process, launch.args, { cwd: launch.options.cwd, env: { ...process.env, ...launch.options.env } });
        const execution = {
          task, child, output: "", terminateCount: 0,
          terminate() {
            this.terminateCount += 1;
            if (process.platform === "win32") {
              const killer = spawn(path.join(process.env.SystemRoot, "System32", "taskkill.exe"),
                ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
              killer.on("error", () => child.kill());
            } else child.kill("SIGTERM");
          },
        };
        execution.refreshInputs = [];
        terminals.push({ processId: Promise.resolve(child.pid), sendText: (...args) => execution.refreshInputs.push(args) });
        executions.push(execution);
        queueMicrotask(() => { for (const listener of startListeners) listener({ execution, processId: child.pid }); });
        child.stdout.on("data", (data) => { execution.output += data.toString(); });
        child.stderr.on("data", (data) => { execution.output += data.toString(); });
        execution.closed = new Promise((resolve, reject) => {
          child.on("error", reject);
          child.on("close", (code) => { finish(execution, code); resolve(code); });
        });
        return Promise.resolve(execution);
      },
    },
    async dispose() {
      for (const execution of vscode.tasks.taskExecutions) execution.terminate();
      await Promise.all(executions.map((execution) => execution.closed));
    },
  };
  return vscode;
}

const nodeStep = (script, argv = [], env) => ({
  executablePath: process.execPath, argv: ["-e", script, ...argv], cwd: __dirname, ...(env ? { env } : {}),
});
const job = (steps) => ({ id: "runner-test", steps });
async function waitForOutput(execution, pattern) {
  const deadline = Date.now() + 10000;
  while (!pattern.test(execution.output)) {
    if (execution.ended || Date.now() > deadline) throw new Error(execution.output);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

for (const helper of process.platform === "win32" ? ["platform", "node"] : ["platform"]) {
  test(`${helper}: argv・cwd・env・stdout/stderrを保ち、Enter待ちのままJobを完了する`, { timeout: 15000 }, async (t) => {
    const vscode = fakeVscode({ helper });
    t.after(() => vscode.dispose());
    const argv = ["argument with spaces", "", "$HOME", "a|b", "日本語", "C:\\a b\\", 'a"b', '\\"', "two\nlines", "& echo expanded", "x%PATH%x"];
    const started = [];
    const result = await runJob(vscode, job([
      nodeStep("console.log('DATA:'+JSON.stringify({argv:process.argv.slice(1),cwd:process.cwd(),env:process.env.CW_TEST,flag:process.env.ELECTRON_RUN_AS_NODE}));console.error('STDERR_MARKER')", argv, { CW_TEST: "値" }),
      nodeStep("console.log('SECOND:'+String(process.env.CW_TEST))"),
    ]), { onStepStart: (index) => started.push(index) });
    assert.deepEqual(result, { status: "completed" });
    assert.deepEqual(started, [0, 1]);
    assert.equal(vscode.capturedTasks.length, 1);
    assert.equal(vscode.tasks.taskExecutions.length, 1);
    assert.equal(vscode.listenerCount(), 0);
    const execution = vscode.executions[0];
    await waitForOutput(execution, /Enter キー/);
    const data = JSON.parse(execution.output.match(/^DATA:(.+)$/m)[1]);
    assert.deepEqual(data.argv, argv);
    assert.equal(data.cwd, __dirname);
    assert.equal(data.env, "値");
    assert.equal(data.flag, undefined);
    assert.match(execution.output, /^STDERR_MARKER/m);
    assert.match(execution.output, /^SECOND:undefined/m);
    assert.match(execution.output, /Job が正常終了しました/);
    assert.equal(execution.task.presentationOptions.close, true);
    assert.ok(execution.refreshInputs.length >= 2);
    assert.ok(execution.refreshInputs.every(([text, execute]) => text === "" && execute === false));
    execution.child.stdin.write("x");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(execution.ended, undefined);
    execution.child.stdin.write("\n");
    assert.equal(await execution.closed, 0);
  });

  test(`${helper}: non-zeroで後続Stepを止め、失敗結果をEnter待ち前に返す`, { timeout: 15000 }, async (t) => {
    const vscode = fakeVscode({ helper });
    t.after(() => vscode.dispose());
    const result = await runJob(vscode, job([
      nodeStep("console.log('FIRST')"), nodeStep("process.exit(7)"), nodeStep("console.log('UNREACHABLE')"),
    ]));
    assert.deepEqual(result, { status: "failed", failedStep: 1, exitCode: 7 });
    const execution = vscode.executions[0];
    await waitForOutput(execution, /Enter キー/);
    assert.match(execution.output, /終了コード: 7/);
    assert.doesNotMatch(execution.output, /UNREACHABLE/);
    assert.equal(execution.ended, undefined);
    execution.child.stdin.write("\n");
    assert.equal(await execution.closed, 0);
  });
}

test("起動失敗は終了コード不明で停止し、後続Stepを実行しない", { timeout: 15000 }, async (t) => {
  const vscode = fakeVscode();
  t.after(() => vscode.dispose());
  const result = await runJob(vscode, job([
    { executablePath: path.join(__dirname, "missing-executable"), argv: [], cwd: __dirname },
    nodeStep("console.log('UNREACHABLE')"),
  ]));
  assert.deepEqual(result, { status: "failed", failedStep: 0, exitCode: undefined });
  assert.doesNotMatch(vscode.executions[0].output, /UNREACHABLE/);
});

test("Terminateは親と実行中の子を停止し、JobをCancelledにする", { timeout: 15000 }, async (t) => {
  const vscode = fakeVscode();
  t.after(() => vscode.dispose());
  const controller = new AbortController();
  const promise = runJob(vscode, job([nodeStep("console.log('TARGET_PID='+process.pid);setInterval(()=>{},1000)"), nodeStep("console.log('UNREACHABLE')")]), { signal: controller.signal });
  while (!vscode.executions.length) await new Promise((resolve) => setTimeout(resolve, 10));
  const execution = vscode.executions[0];
  await waitForOutput(execution, /TARGET_PID=\d+/);
  const pid = Number(execution.output.match(/TARGET_PID=(\d+)/)[1]);
  controller.abort();
  assert.deepEqual(await promise, { status: "cancelled" });
  await execution.closed;
  assert.equal(execution.terminateCount, 1);
  assert.equal(vscode.listenerCount(), 0);
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  assert.doesNotMatch(execution.output, /UNREACHABLE/);
});

test("投入前の中止はTaskを起動しない", async () => {
  const vscode = fakeVscode();
  assert.deepEqual(await runJob(vscode, job([nodeStep("")]), { signal: AbortSignal.abort() }), { status: "cancelled" });
  assert.equal(vscode.capturedTasks.length, 0);
});

test("Task起動APIの失敗を返し、終了通知の購読を解放する", async () => {
  const vscode = fakeVscode({ execute: () => { throw new Error("TASK_LAUNCH_ERROR"); } });
  await assert.rejects(runJob(vscode, job([nodeStep("")])), /TASK_LAUNCH_ERROR/);
  assert.equal(vscode.listenerCount(), 0);
});

test("親が接続前に終了してもJobを失敗にし、待ち続けない", async () => {
  const vscode = fakeVscode({ execute: (task, finish) => {
    const execution = { task };
    queueMicrotask(() => finish(execution, undefined));
    return execution;
  } });
  assert.deepEqual(await runJob(vscode, job([nodeStep("")])), { status: "failed", failedStep: 0, exitCode: undefined });
  assert.equal(vscode.listenerCount(), 0);
});
