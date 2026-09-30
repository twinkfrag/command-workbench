const VIEW_ID = "commandWorkbench.queue";
const SNAPSHOT_SCHEME = "command-workbench-snapshot";

function getJobId(value) {
  if (typeof value === "string") {
    return value;
  }
  return value?.jobId ?? value?.id;
}

function describeState(state) {
  if (state.status === "Running") {
    const step = state.currentStep ?? 1;
    return state.terminationRequested
      ? `Terminating · Step ${step}/${state.stepCount}`
      : `Running · Step ${step}/${state.stepCount}`;
  }
  if (state.status === "Failed" && state.failedStep !== undefined) {
    return `Failed at step ${state.failedStep}/${state.stepCount}`;
  }
  return state.status;
}

function iconForStatus(vscode, status) {
  const names = {
    Waiting: "clock",
    Running: "sync~spin",
    Completed: "check",
    Failed: "error",
    Cancelled: "circle-slash",
  };
  return new vscode.ThemeIcon(names[status] ?? "circle-outline");
}

function getSnapshotUri(vscode, jobId) {
  return vscode.Uri.from({
    scheme: SNAPSHOT_SCHEME,
    path: `/${jobId}.json`,
  });
}

class QueueTreeDataProvider {
  constructor(vscode, scheduler) {
    this.vscode = vscode;
    this.scheduler = scheduler;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
  }

  refresh() {
    this.emitter.fire(undefined);
  }

  getTreeItem(state) {
    const item = new this.vscode.TreeItem(
      `Job ${state.jobId.slice(0, 8)}`,
      this.vscode.TreeItemCollapsibleState.None,
    );
    item.id = state.jobId;
    item.jobId = state.jobId;
    item.description = describeState(state);
    item.tooltip = this.makeTooltip(state);
    item.iconPath = iconForStatus(this.vscode, state.status);
    item.contextValue = state.status === "Waiting"
      ? "commandWorkbench.job.waiting"
      : state.status === "Running"
        ? state.terminationRequested
          ? "commandWorkbench.job.terminating"
          : "commandWorkbench.job.running"
        : "commandWorkbench.job.terminal";
    item.command = {
      command: "vscode.open",
      title: "Open Job Snapshot",
      arguments: [getSnapshotUri(this.vscode, state.jobId)],
    };
    return item;
  }

  getChildren(element) {
    return element ? [] : this.scheduler.getStates();
  }

  makeTooltip(state) {
    const parts = [
      `Job: ${state.jobId}`,
      `Status: ${describeState(state)}`,
      `Submitted: ${new Date(state.submittedAt).toLocaleString()}`,
    ];
    if (state.exitCode !== undefined) {
      parts.push(`Exit code: ${state.exitCode}`);
    }
    if (state.error) {
      parts.push(`Error: ${state.error.message}`);
    }
    return parts.join("\n");
  }

  dispose() {
    this.emitter.dispose();
  }
}

function registerQueueUI(vscode, scheduler) {
  const provider = new QueueTreeDataProvider(vscode, scheduler);
  const view = vscode.window.createTreeView(VIEW_ID, {
    treeDataProvider: provider,
    showCollapseAll: false,
  });
  const updateView = () => {
    view.message = scheduler.getStates().length === 0
      ? "Ctrl+Enter で .argslist のJobを投入すると、ここに表示されます。"
      : undefined;
    provider.refresh();
  };

  const snapshotProvider = {
    provideTextDocumentContent(uri) {
      const jobId = uri.path.split("/").pop()?.replace(/\.json$/, "");
      const snapshot = scheduler.getSnapshot(jobId);
      return snapshot ? JSON.stringify(snapshot, null, 2) : "{}\n";
    },
  };
  const snapshotContentRegistration = vscode.workspace.registerTextDocumentContentProvider(
    SNAPSHOT_SCHEME,
    snapshotProvider,
  );
  const stateSubscription = scheduler.subscribe(updateView);
  updateView();

  const cancelWaiting = vscode.commands.registerCommand("commandWorkbench.cancelWaitingJob", (item) => {
    const jobId = getJobId(item);
    if (jobId) {
      scheduler.cancelWaiting(jobId);
    }
  });
  const terminateRunning = vscode.commands.registerCommand("commandWorkbench.terminateRunningJob", (item) => {
    const jobId = getJobId(item);
    if (jobId) {
      scheduler.terminateRunning(jobId);
    }
  });
  const rerunJob = vscode.commands.registerCommand("commandWorkbench.rerunJob", (item) => {
    const jobId = getJobId(item);
    if (jobId) {
      return scheduler.rerun(jobId);
    }
    return undefined;
  });
  const showSnapshot = vscode.commands.registerCommand("commandWorkbench.showJobSnapshot", async (value) => {
    const jobId = getJobId(value);
    if (!jobId || !scheduler.getState(jobId)) {
      return undefined;
    }
    const uri = getSnapshotUri(vscode, jobId);
    let document = await vscode.workspace.openTextDocument(uri);
    if (document.languageId !== "json") {
      document = await vscode.languages.setTextDocumentLanguage(document, "json");
    }
    return vscode.window.showTextDocument(document, { preview: true });
  });

  return [
    provider,
    view,
    snapshotContentRegistration,
    stateSubscription,
    cancelWaiting,
    terminateRunning,
    rerunJob,
    showSnapshot,
  ];
}

module.exports = {
  QueueTreeDataProvider,
  SNAPSHOT_SCHEME,
  VIEW_ID,
  describeState,
  getSnapshotUri,
  getJobId,
  registerQueueUI,
};
