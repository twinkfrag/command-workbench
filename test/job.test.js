const assert = require("node:assert/strict");
const test = require("node:test");
const { createJobSnapshot } = require("../src/queue/job");
const { parseArgsList } = require("../src/language/parser");

test("source、解決済みexecutable、cwd、argvをimmutable Jobにsnapshotする", () => {
  const sourceText = "@exec node\n-e console.log(1)";
  const definition = parseArgsList(sourceText, {
    commands: { node: process.execPath },
    defaultCwd: process.cwd(),
  });
  const job = createJobSnapshot(sourceText, definition, {
    submittedAt: 123,
    createId: () => "job-1",
  });

  assert.equal(job.id, "job-1");
  assert.equal(job.sourceText, sourceText);
  assert.equal(job.submittedAt, 123);
  assert.equal(job.steps[0].executableAlias, "node");
  assert.equal(job.steps[0].executablePath, require("node:fs").realpathSync.native(process.execPath));
  assert.equal(job.steps[0].cwd, process.cwd());
  assert.deepEqual(job.steps[0].argv, ["-e", "console.log(1)"]);
  assert.equal(Object.isFrozen(job), true);
  assert.equal(Object.isFrozen(job.steps), true);
  assert.equal(Object.isFrozen(job.steps[0].argv), true);
});

test("未解決PATH名にsubmit時点のPATHをsnapshotする", () => {
  const sourceText = "@exec delayed\nargument";
  const definition = parseArgsList(sourceText, {
    commands: { delayed: "tool-that-is-not-installed" },
    defaultCwd: process.cwd(),
  });
  const oldEnvironment = { PATH: "D:\\tools", PATHEXT: ".EXE" };
  const job = createJobSnapshot(sourceText, definition, { environment: oldEnvironment });
  oldEnvironment.PATH = "D:\\changed";

  assert.deepEqual(job.steps[0].env, { PATH: "D:\\tools", PATHEXT: ".EXE" });
});

test("cwdが解決できないStepをJobにしない", () => {
  const definition = {
    steps: [{ commandProfile: "node", executable: process.execPath, cwd: undefined, argv: [] }],
  };

  assert.throws(() => createJobSnapshot("source", definition), { code: "UNRESOLVED_CWD" });
});
