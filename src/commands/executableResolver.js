const fs = require("node:fs");
const path = require("node:path");

function resolveExistingFile(candidate, filesystem) {
  try {
    if (!filesystem.statSync(candidate).isFile()) {
      return undefined;
    }
    return (filesystem.realpathSync.native ?? filesystem.realpathSync)(candidate);
  } catch {
    return undefined;
  }
}

function resolveExecutable(executable, {
  cwd,
  environment = process.env,
  platform = process.platform,
  filesystem = fs,
} = {}) {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const pathExtKey = Object.keys(environment).find((key) => key.toLowerCase() === "pathext");
  const pathValue = environment[pathKey] ?? "";
  const pathExtValue = pathExtKey ? environment[pathExtKey] : ".COM;.EXE;.BAT;.CMD";
  const baseDirectory = cwd ?? process.cwd();
  const hasPathPart = pathApi.isAbsolute(executable)
    || /[\\/]/.test(executable)
    || (platform === "win32" && /^[a-zA-Z]:/.test(executable));

  let candidates;
  if (hasPathPart) {
    candidates = [pathApi.resolve(baseDirectory, executable)];
  } else {
    const pathEntries = pathValue.split(platform === "win32" ? ";" : path.delimiter);
    const extensions = platform === "win32" && pathApi.extname(executable) === ""
      ? pathExtValue.split(";").filter(Boolean)
      : [""];
    candidates = pathEntries.flatMap((directory) => {
      const base = directory || baseDirectory;
      return extensions.map((extension) => pathApi.join(base, `${executable}${extension}`));
    });
  }

  for (const candidate of candidates) {
    const resolved = resolveExistingFile(candidate, filesystem);
    if (resolved) {
      return { executablePath: resolved, resolved: true };
    }
  }

  if (hasPathPart) {
    return { executablePath: candidates[0], resolved: false };
  }

  const env = { [pathKey]: pathValue };
  if (pathExtKey) {
    env[pathExtKey] = environment[pathExtKey];
  }
  return { executablePath: executable, resolved: false, env: Object.freeze(env) };
}

module.exports = { resolveExecutable };
