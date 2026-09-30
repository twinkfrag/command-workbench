const { ArgsListError } = require("../language/errors");

function normalizeCommandProfiles(commands) {
  const source = commands === undefined ? {} : commands;
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    throw new ArgsListError("commandWorkbench.commands は profile の object で指定してください。", {
      code: "INVALID_COMMAND_PROFILES",
    });
  }

  const profiles = new Map();
  for (const [alias, definition] of Object.entries(source)) {
    if (alias.trim().length === 0) {
      throw new ArgsListError("Command Profile の alias は空にできません。", {
        code: "INVALID_COMMAND_PROFILE",
      });
    }

    let executable;
    let args;
    if (typeof definition === "string") {
      executable = definition;
      args = [];
    } else if (definition !== null && typeof definition === "object" && !Array.isArray(definition)) {
      const unknownKeys = Object.keys(definition).filter((key) => key !== "executable" && key !== "args");
      if (unknownKeys.length > 0) {
        throw new ArgsListError(`Command Profile "${alias}" に未対応の設定があります: ${unknownKeys.join(", ")}`, {
          code: "INVALID_COMMAND_PROFILE",
        });
      }
      executable = definition.executable;
      args = definition.args ?? [];
    } else {
      throw new ArgsListError(`Command Profile "${alias}" の形式が正しくありません。`, {
        code: "INVALID_COMMAND_PROFILE",
      });
    }

    if (typeof executable !== "string" || executable.trim().length === 0) {
      throw new ArgsListError(`Command Profile "${alias}" に有効な executable がありません。`, {
        code: "INVALID_COMMAND_PROFILE",
      });
    }
    if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string")) {
      throw new ArgsListError(`Command Profile "${alias}" の args は文字列の配列にしてください。`, {
        code: "INVALID_COMMAND_PROFILE",
      });
    }

    profiles.set(alias, Object.freeze({
      alias,
      executable,
      args: Object.freeze([...args]),
    }));
  }

  return profiles;
}

module.exports = { normalizeCommandProfiles };
