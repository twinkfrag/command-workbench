function makeTask(vscode, job, step, stepIndex) {
  const name = `Command Workbench ${job.id}`;
  const execution = new vscode.ProcessExecution(step.executablePath, [...step.argv], {
    cwd: step.cwd,
    ...(step.env ? { env: { ...step.env } } : {}),
  });
  const task = new vscode.Task(
    {
      type: "commandWorkbench",
      jobId: job.id,
    },
    vscode.TaskScope.Workspace,
    name,
    "Command Workbench",
    execution,
  );
  task.detail = `Step ${stepIndex + 1}/${job.steps.length}`;
  task.presentationOptions = {
    echo: true,
    reveal: vscode.TaskRevealKind.Always,
    focus: false,
    panel: vscode.TaskPanelKind.Dedicated,
    clear: false,
    showReuseMessage: false,
  };
  return task;
}

function executeProcessTask(vscode, task) {
  return new Promise((resolve, reject) => {
    let processEndEvent;
    let executeTaskResolved = false;
    let settled = false;
    let subscription;

    const finish = (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      subscription?.dispose();
      resolve(exitCode);
    };

    subscription = vscode.tasks.onDidEndTaskProcess((event) => {
      if (event.execution.task.name !== task.name) {
        return;
      }
      if (!executeTaskResolved) {
        processEndEvent = event;
        return;
      }
      finish(event.exitCode);
    });

    try {
      Promise.resolve(vscode.tasks.executeTask(task)).then(() => {
        executeTaskResolved = true;
        if (processEndEvent) {
          finish(processEndEvent.exitCode);
        }
      }, (error) => {
        if (!settled) {
          settled = true;
          subscription?.dispose();
          reject(error);
        }
      });
    } catch (error) {
      settled = true;
      subscription?.dispose();
      reject(error);
    }
  });
}

async function runStep(vscode, job, stepIndex) {
  const task = makeTask(vscode, job, job.steps[stepIndex], stepIndex);
  return executeProcessTask(vscode, task);
}

async function runJob(vscode, job, { onStepStart } = {}) {
  for (let index = 0; index < job.steps.length; index += 1) {
    onStepStart?.(index);
    const exitCode = await runStep(vscode, job, index);
    if (exitCode !== 0) {
      return Object.freeze({
        status: "failed",
        failedStep: index,
        exitCode,
      });
    }
  }

  return Object.freeze({ status: "completed" });
}

module.exports = { executeProcessTask, makeTask, runJob, runStep };
