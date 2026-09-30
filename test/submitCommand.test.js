const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const manifest = require("../package.json");
const { getDefaultCwd, submitArgsList } = require("../src/commands/submitCommand");

test("package manifestで.argslist、Command、Ctrl+Enterを登録する", () => {
  assert.equal(manifest.contributes.languages[0].extensions.includes(".argslist"), true);
  assert.equal(manifest.contributes.commands.some((entry) => entry.command === "commandWorkbench.submit"), true);
  assert.equal(manifest.contributes.keybindings.some((entry) => (
    entry.command === "commandWorkbench.submit"
      && entry.key === "ctrl+enter"
      && entry.when === "editorLangId == argslist"
  )), true);
});

test("saved fileではdocumentのparent directoryをdefault cwdにする", () => {
  const vscode = {
    workspace: {
      getWorkspaceFolder() {
        throw new Error("saved file should not look up a workspace folder");
      },
      getConfiguration() {
        throw new Error("saved file should not read defaultCwd");
      },
    },
  };
  const document = { uri: { scheme: "file", fsPath: "D:\\work\\run.argslist" } };

  assert.equal(getDefaultCwd(vscode, document), path.dirname(document.uri.fsPath));
});

test("Untitled documentはworkspaceをdefault cwdより優先する", () => {
  const vscode = {
    workspace: {
      getWorkspaceFolder() {
        return undefined;
      },
      workspaceFolders: [{ uri: { fsPath: "D:\\workspace" } }],
      getConfiguration() {
        throw new Error("workspace folder should be used before defaultCwd");
      },
    },
  };

  assert.equal(getDefaultCwd(vscode, { uri: { scheme: "untitled" } }), "D:\\workspace");
});

test("active editorの未保存textを使い、保存操作を呼ばずにJob化する", async () => {
  const sourceText = "@exec node\n-e console.log('snapshot')";
  const tasks = new Set();
  const submittedTasks = [];
  class ProcessExecution {
    constructor(process, args, options) {
      Object.assign(this, { process, args, options });
    }
  }
  class Task {
    constructor(definition, scope, name, source, execution) {
      Object.assign(this, { definition, scope, name, source, execution });
    }
  }
  const document = {
    languageId: "argslist",
    uri: { scheme: "file", fsPath: path.join(process.cwd(), "example.argslist") },
    getText: () => sourceText,
  };
  const vscode = {
    ProcessExecution,
    Task,
    TaskScope: { Workspace: 2 },
    TaskRevealKind: { Always: 1 },
    TaskPanelKind: { Dedicated: 2 },
    window: {
      activeTextEditor: { document, save: () => { throw new Error("must not save the document"); } },
      showErrorMessage: (message) => { throw new Error(message); },
      showWarningMessage: (message) => { throw new Error(message); },
    },
    workspace: {
      getConfiguration: () => ({ get: (name, fallback) => name === "commands" ? { node: process.execPath } : fallback }),
    },
    tasks: {
      onDidEndTaskProcess(listener) {
        tasks.add(listener);
        return { dispose: () => tasks.delete(listener) };
      },
      executeTask(task) {
        submittedTasks.push(task);
        const execution = { task };
        queueMicrotask(() => {
          for (const listener of [...tasks]) {
            listener({ execution, exitCode: 0 });
          }
        });
        return Promise.resolve(execution);
      },
    },
  };

  const result = await submitArgsList(vscode);

  assert.equal(result.job.sourceText, sourceText);
  assert.equal(result.job.steps.length, 1);
  assert.deepEqual(submittedTasks[0].execution.args, ["-e", "console.log('snapshot')"]);
  assert.equal(result.result.status, "completed");
});

test("Untitled documentはdefaultCwdへfallbackし、未設定ならerrorにする", () => {
  const vscode = {
    workspace: {
      getWorkspaceFolder: () => undefined,
      workspaceFolders: undefined,
      getConfiguration: () => ({ get: () => "D:\\fallback" }),
    },
  };
  assert.equal(getDefaultCwd(vscode, { uri: { scheme: "untitled" } }), path.resolve("D:\\fallback"));

  vscode.workspace.getConfiguration = () => ({ get: () => "" });
  assert.throws(() => getDefaultCwd(vscode, { uri: { scheme: "untitled" } }), /cwd/);
});
