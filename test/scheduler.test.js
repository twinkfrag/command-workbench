const assert = require("node:assert/strict");
const test = require("node:test");
const { JobScheduler } = require("../src/queue/scheduler");

function makeJob(id, stepCount = 1) {
  return Object.freeze({
    id,
    submittedAt: Number(id.replace(/\D/g, "")) || 1,
    sourceText: `job ${id}`,
    steps: Object.freeze(Array.from({ length: stepCount }, () => Object.freeze({ argv: Object.freeze([]) }))),
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("JobをFIFOで実行し、step開始・完了状態を保持する", async () => {
  const pending = [];
  const starts = [];
  const updates = [];
  const scheduler = new JobScheduler({
    maxParallelJobs: 1,
    executeJob: (job, callbacks) => {
      starts.push(job.id);
      const run = deferred();
      pending.push({ ...run, callbacks });
      return run.promise;
    },
    onStateChange: (state) => updates.push(state),
  });

  const first = scheduler.submit(makeJob("job-1", 2));
  const second = scheduler.submit(makeJob("job-2"));
  await nextTurn();

  assert.deepEqual(starts, ["job-1"]);
  assert.equal(scheduler.getState("job-2").status, "Waiting");
  assert.equal(scheduler.getStates().length, 2);

  pending[0].callbacks.onStepStart(0);
  assert.equal(scheduler.getState("job-1").currentStep, 1);
  pending[0].callbacks.onStepStart(1);
  assert.equal(scheduler.getState("job-1").currentStep, 2);
  pending[0].resolve({ status: "completed" });
  assert.equal((await first.completion).status, "Completed");
  await nextTurn();

  assert.deepEqual(starts, ["job-1", "job-2"]);
  pending[1].resolve({ status: "completed" });
  assert.equal((await second.completion).status, "Completed");
  assert.deepEqual(updates.filter((state) => state.jobId === "job-1").map((state) => state.status), [
    "Waiting",
    "Running",
    "Running",
    "Running",
    "Completed",
  ]);
});

test("並列度を上げると増えたslot分のWaiting Jobを開始する", async () => {
  const pending = [];
  const starts = [];
  const scheduler = new JobScheduler({
    maxParallelJobs: 1,
    executeJob: (job) => {
      starts.push(job.id);
      const run = deferred();
      pending.push(run);
      return run.promise;
    },
  });
  const first = scheduler.submit(makeJob("job-1"));
  const second = scheduler.submit(makeJob("job-2"));
  const third = scheduler.submit(makeJob("job-3"));
  await nextTurn();
  assert.deepEqual(starts, ["job-1"]);

  scheduler.setMaxParallelJobs(3);
  await nextTurn();
  assert.deepEqual(starts, ["job-1", "job-2", "job-3"]);

  pending[0].resolve({ status: "completed" });
  pending[1].resolve({ status: "completed" });
  pending[2].resolve({ status: "completed" });
  assert.deepEqual((await Promise.all([first.completion, second.completion, third.completion])).map((state) => state.status), [
    "Completed",
    "Completed",
    "Completed",
  ]);
});

test("並列度を下げてもRunning Jobは継続し、空きができるまで新規開始を抑える", async () => {
  const pending = [];
  const starts = [];
  const scheduler = new JobScheduler({
    maxParallelJobs: 2,
    executeJob: (job) => {
      starts.push(job.id);
      const run = deferred();
      pending.push(run);
      return run.promise;
    },
  });
  const first = scheduler.submit(makeJob("job-1"));
  const second = scheduler.submit(makeJob("job-2"));
  const third = scheduler.submit(makeJob("job-3"));
  await nextTurn();
  assert.deepEqual(starts, ["job-1", "job-2"]);

  scheduler.setMaxParallelJobs(1);
  pending[0].resolve({ status: "completed" });
  assert.equal((await first.completion).status, "Completed");
  await nextTurn();
  assert.deepEqual(starts, ["job-1", "job-2"]);
  assert.equal(scheduler.getState("job-2").status, "Running");
  assert.equal(scheduler.getState("job-3").status, "Waiting");

  pending[1].resolve({ status: "completed" });
  assert.equal((await second.completion).status, "Completed");
  await nextTurn();
  assert.deepEqual(starts, ["job-1", "job-2", "job-3"]);
  pending[2].resolve({ status: "completed" });
  assert.equal((await third.completion).status, "Completed");
});

test("失敗JobをFailedとして記録し、後続のQueue Jobを開始する", async () => {
  const starts = [];
  const scheduler = new JobScheduler({
    executeJob: async (job) => {
      starts.push(job.id);
      if (job.id === "job-1") {
        return { status: "failed", failedStep: 1, exitCode: 9 };
      }
      return { status: "completed" };
    },
  });
  const first = scheduler.submit(makeJob("job-1", 2));
  const second = scheduler.submit(makeJob("job-2"));

  const firstState = await first.completion;
  const secondState = await second.completion;
  assert.deepEqual(starts, ["job-1", "job-2"]);
  assert.equal(firstState.status, "Failed");
  assert.equal(firstState.failedStep, 2);
  assert.equal(firstState.exitCode, 9);
  assert.equal(secondState.status, "Completed");
});

test("並列度とJob IDの入力を検証する", () => {
  assert.throws(() => new JobScheduler({ maxParallelJobs: 0, executeJob: async () => ({ status: "completed" }) }), RangeError);
  assert.throws(() => new JobScheduler({ executeJob: "not a function" }), TypeError);

  const scheduler = new JobScheduler({ executeJob: async () => ({ status: "completed" }) });
  assert.throws(() => scheduler.setMaxParallelJobs(1.5), RangeError);
  scheduler.submit(makeJob("job-1"));
  assert.throws(() => scheduler.submit(makeJob("job-1")), /既にQueue/);
});

test("Waiting JobをCancelし、後続のWaiting Jobを開始する", async () => {
  const pending = [];
  const starts = [];
  const scheduler = new JobScheduler({
    maxParallelJobs: 1,
    executeJob: (job) => {
      starts.push(job.id);
      const run = deferred();
      pending.push(run);
      return run.promise;
    },
  });
  const first = scheduler.submit(makeJob("job-1"));
  const cancelled = scheduler.submit(makeJob("job-2"));
  const third = scheduler.submit(makeJob("job-3"));
  await nextTurn();

  assert.equal(scheduler.cancelWaiting("job-2"), true);
  assert.equal((await cancelled.completion).status, "Cancelled");
  pending[0].resolve({ status: "completed" });
  assert.equal((await first.completion).status, "Completed");
  await nextTurn();

  assert.deepEqual(starts, ["job-1", "job-3"]);
  pending[1].resolve({ status: "completed" });
  assert.equal((await third.completion).status, "Completed");
  assert.equal(scheduler.cancelWaiting("job-2"), false);
});

test("Running JobのTerminateでsignalをabortし、完了後にCancelledにする", async () => {
  const pending = [];
  const scheduler = new JobScheduler({
    executeJob: (job, callbacks) => {
      const run = deferred();
      pending.push({ job, ...run, signal: callbacks.signal });
      return run.promise;
    },
  });
  const submission = scheduler.submit(makeJob("job-1"));
  await nextTurn();

  assert.equal(scheduler.terminateRunning("job-1"), true);
  assert.equal(pending[0].signal.aborted, true);
  assert.equal(scheduler.getState("job-1").terminationRequested, true);
  assert.equal(scheduler.terminateRunning("job-1"), false);
  pending[0].resolve({ status: "cancelled" });

  assert.equal((await submission.completion).status, "Cancelled");
  assert.equal(scheduler.getState("job-1").terminationRequested, true);
});

test("Rerunは新しいQueue IDで元のimmutableな実行snapshotを使う", async () => {
  const executed = [];
  const snapshot = Object.freeze({
    id: "job-original",
    submittedAt: 123,
    sourceText: "@exec tool\n--fixed input.dat",
    steps: Object.freeze([Object.freeze({
      executablePath: "C:\\tools\\tool.exe",
      cwd: "C:\\work",
      argv: Object.freeze(["--fixed", "input.dat"]),
      env: Object.freeze({ PATH: "C:\\tools" }),
    })]),
  });
  const scheduler = new JobScheduler({
    executeJob: async (job) => {
      executed.push(job);
      return { status: "completed" };
    },
    createRerunId: () => "job-rerun",
  });
  const original = scheduler.submit(snapshot);
  await original.completion;

  const rerun = scheduler.rerun("job-original");
  await rerun.completion;

  assert.equal(rerun.jobId, "job-rerun");
  assert.equal(executed[1].sourceText, snapshot.sourceText);
  assert.equal(executed[1].submittedAt, snapshot.submittedAt);
  assert.strictEqual(executed[1].steps, snapshot.steps);
  assert.equal(executed[1].steps[0].argv.join(" "), "--fixed input.dat");
  assert.equal(scheduler.getState("job-original").status, "Completed");
});

test("実行開始エラーもTree View向けに失敗Step番号を保持する", async () => {
  const scheduler = new JobScheduler({
    executeJob: (job, callbacks) => {
      callbacks.onStepStart(1);
      throw new Error("process could not start");
    },
  });
  const submission = scheduler.submit(makeJob("job-start-error", 2));
  const state = await submission.completion;

  assert.equal(state.status, "Failed");
  assert.equal(state.failedStep, 2);
  assert.match(state.error.message, /could not start/);
});
