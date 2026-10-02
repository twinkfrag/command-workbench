const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const manifest = require("../package.json");
const { getDefaultCwd, submitArgsList } = require("../src/commands/submitCommand");
const { JobScheduler } = require("../src/queue/scheduler");

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
  const document = {
    languageId: "argslist",
    uri: { scheme: "file", fsPath: path.join(process.cwd(), "example.argslist") },
    getText: () => sourceText,
  };
  const vscode = {
    window: {
      activeTextEditor: { document, save: () => { throw new Error("must not save the document"); } },
      showErrorMessage: (message) => { throw new Error(message); },
      showWarningMessage: (message) => { throw new Error(message); },
    },
    workspace: {
      getConfiguration: () => ({ get: (name, fallback) => name === "commands" ? { node: process.execPath } : fallback }),
    },
  };
  const scheduler = new JobScheduler({ executeJob: async () => ({ status: "completed" }) });

  const result = await submitArgsList(vscode, scheduler);

  assert.equal(result.job.sourceText, sourceText);
  assert.equal(result.job.steps.length, 1);
  assert.deepEqual(result.job.steps[0].argv, ["-e", "console.log('snapshot')"]);
  assert.equal((await result.submission.completion).status, "Completed");
});

test("Untitled documentはdefaultCwdへfallbackし、未設定ならparserでcwdを判断する", () => {
  const vscode = {
    workspace: {
      getWorkspaceFolder: () => undefined,
      workspaceFolders: undefined,
      getConfiguration: () => ({ get: () => "D:\\fallback" }),
    },
  };
  assert.equal(getDefaultCwd(vscode, { uri: { scheme: "untitled" } }), path.resolve("D:\\fallback"));

  vscode.workspace.getConfiguration = () => ({ get: () => "" });
  assert.equal(getDefaultCwd(vscode, { uri: { scheme: "untitled" } }), undefined);
});

test("workspaceもdefaultCwdもないUntitled documentを絶対@cwdで実行できる", async () => {
  const cwd = process.cwd();
  let sourceText = `@cwd "${cwd}"\n@exec node\n--version`;
  const errors = [];
  const vscode = {
    window: {
      activeTextEditor: {
        document: {
          languageId: "argslist",
          uri: { scheme: "untitled" },
          getText: () => sourceText,
        },
      },
      showErrorMessage: (message) => errors.push(message),
    },
    workspace: {
      getWorkspaceFolder: () => undefined,
      getConfiguration: () => ({ get: (name, fallback) => name === "commands" ? { node: process.execPath } : fallback }),
    },
  };
  const scheduler = new JobScheduler({ executeJob: async () => ({ status: "completed" }) });

  const result = await submitArgsList(vscode, scheduler);
  assert.equal(result.job.steps[0].cwd, cwd);
  assert.equal((await result.submission.completion).status, "Completed");
  assert.deepEqual(errors, []);

  sourceText = "@exec node\n--version";
  assert.equal(await submitArgsList(vscode, scheduler), undefined);
  sourceText = "@cwd relative\n@exec node\n--version";
  assert.equal(await submitArgsList(vscode, scheduler), undefined);
  assert.equal(errors.length, 2);
  assert.equal(scheduler.getStates().length, 1);
});
