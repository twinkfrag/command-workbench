const { randomUUID } = require("node:crypto");
const { resolveExecutable } = require("../commands/executableResolver");
const { ArgsListError } = require("../language/errors");

function createJobSnapshot(sourceText, definition, {
  environment = process.env,
  platform = process.platform,
  submittedAt = Date.now(),
  createId = randomUUID,
  executableResolver = resolveExecutable,
} = {}) {
  if (typeof sourceText !== "string") {
    throw new TypeError("sourceText must be a string");
  }

  const steps = definition.steps.map((step) => {
    if (typeof step.cwd !== "string" || step.cwd.length === 0) {
      throw new ArgsListError("Step の cwd を決定できません。", { code: "UNRESOLVED_CWD" });
    }

    const executable = executableResolver(step.executable, {
      cwd: step.cwd,
      environment,
      platform,
    });
    return Object.freeze({
      executableAlias: step.commandProfile,
      executablePath: executable.executablePath,
      cwd: step.cwd,
      argv: Object.freeze([...step.argv]),
      ...(executable.env ? { env: executable.env } : {}),
    });
  });

  return Object.freeze({
    id: createId(),
    sourceText,
    submittedAt,
    steps: Object.freeze(steps),
  });
}

module.exports = { createJobSnapshot };
