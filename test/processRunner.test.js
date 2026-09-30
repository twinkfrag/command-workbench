const assert = require("node:assert/strict");
const test = require("node:test");
const { runJob } = require("../src/execution/processRunner");

function createFakeVscode(exitCodes) {
  const listeners = new Set();
  const tasks = [];

  class ProcessExecution {
    constructor(process, args, options) {
      this.process = process;
      this.args = args;
      this.options = options;
    }
  }

  class Task {
    constructor(definition, scope, name, source, execution) {
      Object.assign(this, { definition, scope, name, source, execution });
      tasks.push(this);
    }
  }

  return {
    TaskScope: { Workspace: 2 },
    TaskRevealKind: { Always: 1 },
    TaskPanelKind: { Dedicated: 2 },
    ProcessExecution,
    Task,
    tasks: {
      onDidEndTaskProcess(listener) {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
      executeTask(task) {
        const execution = { task };
        const eventExecution = { task };
        const exitCode = exitCodes[tasks.indexOf(task)];
        queueMicrotask(() => {
          for (const listener of [...listeners]) {
            listener({ execution: eventExecution, exitCode });
          }
        });
        return Promise.resolve(execution);
      },
    },
    captureTasks: tasks,
  };
}

test("ProcessExecutionへexecutable、argv、cwdを渡し、Stepを逐次実行する", async () => {
  const vscode = createFakeVscode([0, 0]);
  const job = {
    id: "job-1",
    steps: [
      { executablePath: "C:\\tools\\ffmpeg.exe", argv: ["-i", "input file.mkv"], cwd: "C:\\work" },
      { executablePath: "C:\\tools\\ffprobe.exe", argv: ["output.mkv"], cwd: "C:\\work" },
    ],
  };
  const startedSteps = [];

  const result = await runJob(vscode, job, { onStepStart: (index) => startedSteps.push(index) });

  assert.deepEqual(result, { status: "completed" });
  assert.deepEqual(startedSteps, [0, 1]);
  assert.equal(vscode.captureTasks.length, 2);
  assert.equal(vscode.captureTasks[0].execution instanceof vscode.ProcessExecution, true);
  assert.equal(vscode.captureTasks[0].execution.process, "C:\\tools\\ffmpeg.exe");
  assert.deepEqual(vscode.captureTasks[0].execution.args, ["-i", "input file.mkv"]);
  assert.equal(vscode.captureTasks[0].execution.options.cwd, "C:\\work");
  assert.equal(vscode.captureTasks[0].presentationOptions.panel, vscode.TaskPanelKind.Dedicated);
});

test("non-zero exit codeでJobを止め、後続Stepを実行しない", async () => {
  const vscode = createFakeVscode([0, 7, 0]);
  const job = {
    id: "job-2",
    steps: ["one", "two", "three"].map((executablePath) => ({
      executablePath,
      argv: [],
      cwd: "C:\\work",
    })),
  };

  const result = await runJob(vscode, job);

  assert.deepEqual(result, { status: "failed", failedStep: 1, exitCode: 7 });
  assert.equal(vscode.captureTasks.length, 2);
});

test("Task APIからexit codeが得られない終了を失敗として返す", async () => {
  const vscode = createFakeVscode([undefined]);
  const result = await runJob(vscode, {
    id: "job-3",
    steps: [{ executablePath: "tool.exe", argv: [], cwd: "C:\\work" }],
  });

  assert.deepEqual(result, { status: "failed", failedStep: 0, exitCode: undefined });
});
