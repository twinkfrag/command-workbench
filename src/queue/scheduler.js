class JobScheduler {
  constructor({ maxParallelJobs = 1, executeJob, onStateChange = () => {} } = {}) {
    this.validateLimit(maxParallelJobs);
    if (typeof executeJob !== "function") {
      throw new TypeError("executeJob must be a function");
    }
    this.maxParallelJobs = maxParallelJobs;
    this.executeJob = executeJob;
    this.onStateChange = onStateChange;
    this.waiting = [];
    this.running = new Set();
    this.jobs = new Map();
  }

  validateLimit(value) {
    if (!Number.isInteger(value) || value < 1) {
      throw new RangeError("commandWorkbench.maxParallelJobs は1以上の整数にしてください。");
    }
  }

  submit(job) {
    if (!job || typeof job.id !== "string" || !Array.isArray(job.steps) || job.steps.length === 0) {
      throw new TypeError("A Job must have an id and at least one Step");
    }
    if (this.jobs.has(job.id)) {
      throw new Error(`Job ID "${job.id}" は既にQueueへ登録されています。`);
    }

    let resolveCompletion;
    const completion = new Promise((resolve) => {
      resolveCompletion = resolve;
    });
    const record = {
      job,
      status: "Waiting",
      currentStep: undefined,
      result: undefined,
      error: undefined,
      resolveCompletion,
    };
    this.jobs.set(job.id, record);
    this.waiting.push(job.id);
    this.publish(record);
    this.pump();

    return Object.freeze({
      jobId: job.id,
      state: this.getState(job.id),
      completion,
    });
  }

  setMaxParallelJobs(value) {
    this.validateLimit(value);
    this.maxParallelJobs = value;
    this.pump();
  }

  getState(jobId) {
    const record = this.jobs.get(jobId);
    if (!record) {
      return undefined;
    }
    return Object.freeze({
      jobId: record.job.id,
      status: record.status,
      submittedAt: record.job.submittedAt,
      stepCount: record.job.steps.length,
      sourceText: record.job.sourceText,
      steps: record.job.steps,
      ...(record.currentStep === undefined ? {} : { currentStep: record.currentStep }),
      ...(record.result?.failedStep === undefined ? {} : { failedStep: record.result.failedStep + 1 }),
      ...(record.result?.exitCode === undefined ? {} : { exitCode: record.result.exitCode }),
      ...(record.error ? { error: record.error } : {}),
    });
  }

  getStates() {
    return Object.freeze([...this.jobs.keys()].map((jobId) => this.getState(jobId)));
  }

  publish(record) {
    try {
      this.onStateChange(this.getState(record.job.id));
    } catch (error) {
      console.error("Command Workbench state listener failed.", error);
    }
  }

  pump() {
    while (this.running.size < this.maxParallelJobs && this.waiting.length > 0) {
      const jobId = this.waiting.shift();
      const record = this.jobs.get(jobId);
      if (!record || record.status !== "Waiting") {
        continue;
      }

      record.status = "Running";
      record.currentStep = undefined;
      this.running.add(jobId);
      this.publish(record);

      Promise.resolve()
        .then(() => this.executeJob(record.job, {
          onStepStart: (index) => {
            if (record.status !== "Running") {
              return;
            }
            record.currentStep = index + 1;
            this.publish(record);
          },
        }))
        .then((result) => {
          record.result = result;
          record.status = result?.status === "completed" ? "Completed" : "Failed";
          this.finish(record);
        }, (error) => {
          record.error = error;
          record.status = "Failed";
          this.finish(record);
        });
    }
  }

  finish(record) {
    this.running.delete(record.job.id);
    this.publish(record);
    record.resolveCompletion(this.getState(record.job.id));
    this.pump();
  }
}

module.exports = { JobScheduler };
