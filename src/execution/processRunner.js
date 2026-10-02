const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

function makeTask(vscode, job, endpoint) {
  const windows = process.platform === "win32";
  const executable = windows
    ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : process.execPath;
  const args = windows
    ? ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "jobHost.ps1"), endpoint]
    : [path.join(__dirname, "jobHost.js"), endpoint];
  const execution = new vscode.ProcessExecution(executable, args, {
    cwd: job.steps[0].cwd,
    ...(!windows ? { env: { ELECTRON_RUN_AS_NODE: "1" } } : {}),
  });
  const task = new vscode.Task(
    { type: "commandWorkbench", jobId: job.id },
    vscode.TaskScope.Workspace,
    `Command Workbench ${job.id}`,
    "Command Workbench",
    execution,
  );
  task.detail = `${job.steps.length} Step`;
  task.presentationOptions = {
    echo: false, reveal: vscode.TaskRevealKind.Always, focus: false,
    panel: vscode.TaskPanelKind.Dedicated, clear: false,
    showReuseMessage: false, close: true,
  };
  return task;
}

// The Task stays alive at the close prompt. Job progress and completion therefore
// use a private local pipe instead of the Task's process-exit event.
function runJob(vscode, job, { onStepStart, signal } = {}) {
  if (signal?.aborted) return Promise.resolve(Object.freeze({ status: "cancelled" }));
  const directory = process.platform === "win32"
    ? undefined : fs.mkdtempSync(path.join(os.tmpdir(), "command-workbench-"));
  if (directory) fs.chmodSync(directory, 0o700);
  const endpoint = directory ? path.join(directory, "job.sock")
    : `\\\\.\\pipe\\command-workbench-${randomUUID()}`;
  const task = makeTask(vscode, job, endpoint);

  return new Promise((resolve, reject) => {
    let execution;
    let taskResolved = false;
    let result;
    let settled = false;
    let terminated = false;
    let connection;
    let lines;
    let terminal;
    let currentStep = 0;
    const subscriptions = [];
    const server = net.createServer();
    // Sending no characters (and no Enter) requests VS Code's normal input
    // scan, without altering the child's stdin or the close prompt.
    const refreshChildren = () => {
      try { terminal?.sendText("", false); } catch { /* The terminal may have closed. */ }
    };
    const terminate = () => {
      const active = execution
        ?? vscode.tasks.taskExecutions?.find((item) => item.task.name === task.name);
      if (!active || terminated) return;
      terminated = true;
      try { active.terminate(); } catch { /* The Task may already have ended. */ }
    };
    const finish = (value, error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", terminate);
      for (const subscription of subscriptions) subscription.dispose();
      lines?.close();
      connection?.destroy();
      server.close(() => { if (directory) fs.rmdirSync(directory); });
      if (error) reject(error);
      else resolve(Object.freeze(signal?.aborted ? { status: "cancelled" } : value));
    };
    const fail = (error) => {
      if (settled) return;
      terminate();
      finish(undefined, signal?.aborted ? undefined : error);
    };
    const ended = (event) => {
      if (event.execution.task.name !== task.name || settled) return;
      // A connected host flushes its result before closing the pipe. Let its
      // final message arrive before treating a process exit as an unknown failure.
      if (connection && !connection.destroyed) return;
      finish({ status: "failed", failedStep: currentStep, exitCode: undefined });
    };
    server.on("error", fail);
    server.on("connection", (socket) => {
      if (connection || settled) { socket.destroy(); return; }
      connection = socket;
      socket.on("error", fail);
      lines = readline.createInterface({ input: socket, crlfDelay: Infinity });
      lines.on("line", (line) => {
        try {
          const message = JSON.parse(line);
          if (message.type === "step" && Number.isInteger(message.index)
            && message.index >= 0 && message.index < job.steps.length) {
            currentStep = message.index;
            onStepStart?.(currentStep);
            refreshChildren();
          } else if (message.type === "complete") {
            const value = message.result;
            if (value?.status === "completed") result = { status: "completed" };
            else if (value?.status === "failed" && Number.isInteger(value.failedStep)
              && value.failedStep >= 0 && value.failedStep < job.steps.length) {
              result = { status: "failed", failedStep: value.failedStep, exitCode: value.exitCode ?? undefined };
            } else throw new Error("実行結果の形式が不正です。");
            refreshChildren();
            if (taskResolved) finish(result);
          } else throw new Error("実行通知の形式が不正です。");
        } catch (error) { fail(error); }
      });
      socket.on("close", () => {
        if (settled || result) return;
        terminate();
        finish({ status: "failed", failedStep: currentStep, exitCode: undefined });
      });
      socket.write(`${JSON.stringify({ id: job.id, steps: job.steps })}\n`);
      if (signal?.aborted) terminate();
    });
    server.listen(endpoint, () => {
      if (settled) { server.close(); return; }
      subscriptions.push(vscode.tasks.onDidEndTaskProcess(ended));
      subscriptions.push(vscode.tasks.onDidEndTask(ended));
      subscriptions.push(vscode.tasks.onDidStartTaskProcess((event) => {
        if (event.execution.task.name !== task.name) return;
        for (const candidate of vscode.window.terminals) {
          Promise.resolve(candidate.processId).then((pid) => {
            if (pid !== event.processId || terminated || (settled && !result)) return;
            terminal = candidate;
            refreshChildren();
          }).catch(() => { /* The terminal may have closed before its PID arrived. */ });
        }
      }));
      signal?.addEventListener("abort", terminate, { once: true });
      try {
        Promise.resolve(vscode.tasks.executeTask(task)).then((value) => {
          execution = value;
          taskResolved = true;
          if (settled) { terminate(); return; }
          if (signal?.aborted) terminate();
          if (result) finish(result);
        }, fail);
      } catch (error) { fail(error); }
    });
  });
}

module.exports = { makeTask, runJob };
