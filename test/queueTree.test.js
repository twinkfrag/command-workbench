const assert = require("node:assert/strict");
const test = require("node:test");
const manifest = require("../package.json");
const {
  QueueTreeDataProvider,
  SNAPSHOT_SCHEME,
  VIEW_ID,
  describeState,
  registerQueueUI,
} = require("../src/view/queueTree");

function makeState(status, values = {}) {
  return {
    jobId: `job-${status.toLowerCase()}`,
    status,
    submittedAt: 1000,
    stepCount: 3,
    sourceText: "@exec tool\ninput.dat",
    steps: [{ argv: ["input.dat"] }],
    ...values,
  };
}

test("manifest contributes the Queue view and Job operations", () => {
  assert.equal(manifest.contributes.views.explorer.some((view) => view.id === VIEW_ID), true);
  const commands = manifest.contributes.commands.map((entry) => entry.command);
  assert.equal(commands.includes("commandWorkbench.cancelWaitingJob"), true);
  assert.equal(commands.includes("commandWorkbench.terminateRunningJob"), true);
  assert.equal(commands.includes("commandWorkbench.rerunJob"), true);
  assert.equal(commands.includes("commandWorkbench.showJobSnapshot"), true);
  assert.equal(manifest.activationEvents.includes(`onView:${VIEW_ID}`), true);
  const itemCommands = manifest.contributes.menus["view/item/context"].map((entry) => entry.command);
  assert.equal(itemCommands.includes("commandWorkbench.cancelWaitingJob"), true);
  assert.equal(itemCommands.includes("commandWorkbench.terminateRunningJob"), true);
  assert.equal(itemCommands.includes("commandWorkbench.rerunJob"), true);
  assert.equal(itemCommands.includes("commandWorkbench.showJobSnapshot"), true);
});

test("Queue status labels include step counts and cancellation", () => {
  assert.equal(describeState(makeState("Waiting")), "Waiting");
  assert.equal(describeState(makeState("Running", { currentStep: 2 })), "Running · Step 2/3");
  assert.equal(describeState(makeState("Running", { currentStep: 2, terminationRequested: true })), "Terminating · Step 2/3");
  assert.equal(describeState(makeState("Completed")), "Completed");
  assert.equal(describeState(makeState("Failed", { failedStep: 3 })), "Failed at step 3/3");
  assert.equal(describeState(makeState("Cancelled")), "Cancelled");
});

test("Tree provider exposes scheduler states with actions and no nested rows", () => {
  const states = [makeState("Waiting"), makeState("Running", { currentStep: 1 })];
  class EventEmitter {
    constructor() {
      this.fired = 0;
      this.event = () => {};
    }
    fire() {
      this.fired += 1;
    }
    dispose() {}
  }
  class TreeItem {
    constructor(label, collapsibleState) {
      Object.assign(this, { label, collapsibleState });
    }
  }
  class ThemeIcon {
    constructor(id) {
      this.id = id;
    }
  }
  const vscode = {
    EventEmitter,
    TreeItem,
    TreeItemCollapsibleState: { None: 0 },
    ThemeIcon,
    Uri: { from: (parts) => parts },
  };
  const provider = new QueueTreeDataProvider(vscode, { getStates: () => states });
  const children = provider.getChildren();
  const waitingItem = provider.getTreeItem(children[0]);
  const runningItem = provider.getTreeItem(children[1]);

  assert.equal(children.length, 2);
  assert.equal(waitingItem.description, "Waiting");
  assert.equal(waitingItem.contextValue, "commandWorkbench.job.waiting");
  assert.equal(waitingItem.command.command, "vscode.open");
  assert.deepEqual(waitingItem.command.arguments[0], {
    scheme: SNAPSHOT_SCHEME,
    path: `/${states[0].jobId}.json`,
  });
  assert.equal(runningItem.description, "Running · Step 1/3");
  assert.equal(runningItem.contextValue, "commandWorkbench.job.running");
  assert.equal(provider.getTreeItem(makeState("Running", { terminationRequested: true })).contextValue, "commandWorkbench.job.terminating");
  assert.deepEqual(provider.getChildren(children[0]), []);
  provider.dispose();
});

test("Queue UI wires actions and opens the saved Job snapshot document", async () => {
  const commands = new Map();
  const contentProviders = new Map();
  const state = makeState("Completed", { jobId: "job-snapshot", submittedAt: 1234 });
  const snapshot = {
    id: state.jobId,
    submittedAt: state.submittedAt,
    sourceText: state.sourceText,
    steps: [{ executablePath: "tool.exe", cwd: "C:\\work", argv: ["input.dat"] }],
  };
  const calls = [];
  const subscriptions = [];
  class EventEmitter {
    event = () => {};
    fire() {}
    dispose() {}
  }
  class TreeItem {
    constructor(label, collapsibleState) {
      Object.assign(this, { label, collapsibleState });
    }
  }
  class ThemeIcon {
    constructor(id) {
      this.id = id;
    }
  }
  const vscode = {
    EventEmitter,
    TreeItem,
    TreeItemCollapsibleState: { None: 0 },
    ThemeIcon,
    Uri: { from: (parts) => parts },
    commands: {
      registerCommand: (id, callback) => {
        commands.set(id, callback);
        return { dispose() {} };
      },
    },
    languages: {
      setTextDocumentLanguage: async (document, languageId) => ({ ...document, languageId }),
    },
    workspace: {
      registerTextDocumentContentProvider: (scheme, provider) => {
        contentProviders.set(scheme, provider);
        return { dispose() {} };
      },
      openTextDocument: async (uri) => ({ uri, languageId: "plaintext" }),
    },
    window: {
      createTreeView: (viewId, options) => {
        const view = { dispose() {} };
        calls.push({ viewId, options, view });
        return view;
      },
      showTextDocument: async (document, options) => {
        calls.push({ document, options });
        return document;
      },
    },
  };
  const scheduler = {
    getState: (jobId) => jobId === state.jobId ? state : undefined,
    getSnapshot: (jobId) => jobId === state.jobId ? snapshot : undefined,
    getStates: () => [state],
    subscribe: (listener) => {
      subscriptions.push(listener);
      return { dispose() {} };
    },
    cancelWaiting: (jobId) => calls.push({ operation: "cancel", jobId }),
    terminateRunning: (jobId) => calls.push({ operation: "terminate", jobId }),
    rerun: (jobId) => ({ jobId: `${jobId}-rerun` }),
  };

  const disposables = registerQueueUI(vscode, scheduler);
  assert.equal(disposables.length, 8);
  assert.equal(calls[0].viewId, VIEW_ID);
  assert.equal(calls[0].options.treeDataProvider.getTreeItem(state).description, "Completed");
  assert.equal(calls[0].view.message, undefined);
  assert.equal(contentProviders.get(SNAPSHOT_SCHEME).provideTextDocumentContent({ path: "/job-snapshot.json" }), JSON.stringify(snapshot, null, 2));

  commands.get("commandWorkbench.cancelWaitingJob")({ jobId: "waiting-id" });
  commands.get("commandWorkbench.terminateRunningJob")({ jobId: "running-id" });
  assert.deepEqual(commands.get("commandWorkbench.rerunJob")({ jobId: state.jobId }), { jobId: "job-snapshot-rerun" });
  await commands.get("commandWorkbench.showJobSnapshot")(state.jobId);

  assert.deepEqual(calls.filter((call) => call.operation), [
    { operation: "cancel", jobId: "waiting-id" },
    { operation: "terminate", jobId: "running-id" },
  ]);
  const opened = calls.find((call) => call.document);
  assert.equal(opened.document.languageId, "json");
  assert.deepEqual(opened.document.uri, {
    scheme: SNAPSHOT_SCHEME,
    path: "/job-snapshot.json",
  });
  assert.deepEqual(opened.options, { preview: true });
});
