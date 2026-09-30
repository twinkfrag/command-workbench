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

function executeProcessTask(vscode, task, { signal } = {}) {
  return new Promise((resolve, reject) => {
    let processEndEvent;
    let executeTaskResolved = false;
    let settled = false;
    let subscription;
    let taskExecution;
    let terminationSent = false;

    const finish = (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      subscription?.dispose();
      signal?.removeEventListener("abort", onAbort);
      resolve(exitCode);
    };

    const onAbort = () => {
      const activeExecution = taskExecution
        ?? vscode.tasks.taskExecutions?.find((execution) => execution.task.name === task.name);
      if (!activeExecution || terminationSent) {
        return;
      }
      terminationSent = true;
      try {
        activeExecution.terminate();
      } catch {
        // The task may have ended while the cancellation event was delivered.
      }
    };

    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      subscription?.dispose();
      signal?.removeEventListener("abort", onAbort);
      reject(error);
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
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
    }

    try {
      Promise.resolve(vscode.tasks.executeTask(task)).then((execution) => {
        taskExecution = execution;
        executeTaskResolved = true;
        if (signal?.aborted && !processEndEvent) {
          onAbort();
        }
        if (processEndEvent) {
          finish(processEndEvent.exitCode);
        }
      }, (error) => {
        fail(error);
      });
    } catch (error) {
      fail(error);
    }
  });
}

async function runStep(vscode, job, stepIndex, { signal } = {}) {
  const task = makeTask(vscode, job, job.steps[stepIndex], stepIndex);
  return executeProcessTask(vscode, task, { signal });
}

async function runJob(vscode, job, { onStepStart, signal } = {}) {
  for (let index = 0; index < job.steps.length; index += 1) {
    if (signal?.aborted) {
      return Object.freeze({ status: "cancelled" });
    }
    onStepStart?.(index);
    let exitCode;
    try {
      exitCode = await runStep(vscode, job, index, { signal });
    } catch (error) {
      if (signal?.aborted) {
        return Object.freeze({ status: "cancelled" });
      }
      throw error;
    }
    if (signal?.aborted) {
      return Object.freeze({ status: "cancelled" });
    }
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
