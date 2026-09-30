const { registerSubmitCommand } = require("./commands/submitCommand");
const { JobScheduler } = require("./queue/scheduler");
const { runJob } = require("./execution/processRunner");

function activate(context) {
  const vscode = require("vscode");
  const configuration = vscode.workspace.getConfiguration("commandWorkbench");
  const scheduler = new JobScheduler({
    maxParallelJobs: configuration.get("maxParallelJobs", 1),
    executeJob: (job, callbacks) => runJob(vscode, job, callbacks),
  });

  context.subscriptions.push(registerSubmitCommand(vscode, scheduler));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration("commandWorkbench.maxParallelJobs")) {
      return;
    }
    try {
      scheduler.setMaxParallelJobs(
        vscode.workspace.getConfiguration("commandWorkbench").get("maxParallelJobs", 1),
      );
    } catch (error) {
      void vscode.window.showErrorMessage(error.message);
    }
  }));
}

module.exports = {
  activate,
};
