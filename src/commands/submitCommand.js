const path = require("node:path");
const { createJobSnapshot } = require("../queue/job");
const { parseArgsList } = require("../language/parser");
const { runJob } = require("../execution/processRunner");

function getDefaultCwd(vscode, document) {
  if (document.uri.scheme === "file") {
    return path.dirname(document.uri.fsPath);
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
    ?? vscode.workspace.workspaceFolders?.[0];
  if (workspaceFolder) {
    return workspaceFolder.uri.fsPath;
  }

  const configuredDefault = vscode.workspace
    .getConfiguration("commandWorkbench", document.uri)
    .get("defaultCwd", "");
  if (typeof configuredDefault === "string" && configuredDefault.trim().length > 0) {
    return path.resolve(configuredDefault);
  }

  throw new Error("Untitled document のcwdを決定できません。workspace folderかdefault cwdを設定してください。");
}

function formatError(error) {
  const location = error.line ? ` (${error.line}:${error.column ?? 1})` : "";
  return `${error.message}${location}`;
}

async function submitArgsList(vscode) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "argslist") {
    await vscode.window.showWarningMessage(".argslist documentをactive editorで開いてください。");
    return undefined;
  }

  try {
    const document = editor.document;
    const sourceText = document.getText();
    const defaultCwd = getDefaultCwd(vscode, document);
    const commands = vscode.workspace
      .getConfiguration("commandWorkbench", document.uri)
      .get("commands", {});
    const definition = parseArgsList(sourceText, { commands, defaultCwd });
    const job = createJobSnapshot(sourceText, definition);
    const result = await runJob(vscode, job);

    if (result.status === "failed") {
      const exitText = result.exitCode === undefined ? "不明" : String(result.exitCode);
      await vscode.window.showErrorMessage(`JobのStep ${result.failedStep + 1}/${job.steps.length} が失敗しました（exit code ${exitText}）。`);
    }
    return Object.freeze({ job, result });
  } catch (error) {
    await vscode.window.showErrorMessage(formatError(error));
    return undefined;
  }
}

function registerSubmitCommand(vscode) {
  return vscode.commands.registerCommand("commandWorkbench.submit", () => submitArgsList(vscode));
}

module.exports = { getDefaultCwd, registerSubmitCommand, submitArgsList };
