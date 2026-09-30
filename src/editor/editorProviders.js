const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const { getCwdBeforeLine } = require("../language/parser");

const DROP_MIME_TYPES = Object.freeze(["files", "text/uri-list"]);

function quotePath(value) {
  if (/["\r\n\t]/.test(value)) {
    return undefined;
  }
  return `"${value}"`;
}

function getLocalUriPath(uri) {
  if (!uri) {
    return undefined;
  }
  if (uri.scheme && uri.scheme !== "file") {
    return undefined;
  }
  if (typeof uri.fsPath === "string") {
    return uri.fsPath;
  }
  if (typeof uri === "string") {
    try {
      const parsed = new URL(uri);
      return parsed.protocol === "file:" ? fileURLToPath(parsed) : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function parseUriList(value) {
  const paths = [];
  for (const line of value.split(/\r\n|\r|\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const localPath = getLocalUriPath(trimmed);
    if (localPath) {
      paths.push(localPath);
    }
  }
  return paths;
}

async function getDropPaths(dataTransfer) {
  const paths = [];
  const seen = new Set();
  const add = (value) => {
    if (typeof value !== "string" || !value || /["\r\n\t]/.test(value) || seen.has(value)) {
      return;
    }
    seen.add(value);
    paths.push(value);
  };

  for (const [mimeType, item] of dataTransfer) {
    if (mimeType.toLowerCase() === "files") {
      add(getLocalUriPath(item.asFile()?.uri));
    } else if (mimeType.toLowerCase() === "text/uri-list") {
      const uriList = await item.asString();
      for (const localPath of parseUriList(uriList)) {
        add(localPath);
      }
    }
  }
  return paths;
}

function makeDropText(paths, beforeCharacter = "", afterCharacter = "") {
  const quoted = paths.map(quotePath);
  if (quoted.length === 0 || quoted.some((value) => value === undefined)) {
    return undefined;
  }
  const prefix = beforeCharacter && !/[ \t\r\n]/.test(beforeCharacter) ? " " : "";
  const suffix = afterCharacter && !/[ \t\r\n]/.test(afterCharacter) ? " " : "";
  return `${prefix}${quoted.join(" ")}${suffix}`;
}

function getCurrentToken(linePrefix) {
  let quoted = false;
  let start = 0;
  for (let index = 0; index < linePrefix.length; index += 1) {
    const character = linePrefix[index];
    if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && /[ \t]/.test(character)) {
      start = index + 1;
    }
  }
  return { start, text: linePrefix.slice(start) };
}

function isPathPrefix(value) {
  return /[\\/]/.test(value) || /^[A-Za-z]:/.test(value);
}

function isQuotedAtStartOfLine(lines, lineNumber) {
  let quoted = false;
  for (let index = 0; index < lineNumber; index += 1) {
    const line = lines[index] ?? "";
    if (!quoted && /^\s*(#|@)/.test(line)) {
      continue;
    }
    for (const character of line) {
      if (character === '"') {
        quoted = !quoted;
      }
    }
  }
  return quoted;
}

function getCompletionContext(source, lineNumber, character, defaultCwd) {
  const lines = source.split(/\r\n|\r|\n/);
  const line = lines[lineNumber] ?? "";
  const linePrefix = line.slice(0, character);
  const leading = linePrefix.match(/^\s*/)[0];
  const content = linePrefix.slice(leading.length);
  const quotedBeforeLine = isQuotedAtStartOfLine(lines, lineNumber);
  if (!quotedBeforeLine && content.startsWith("#")) {
    return undefined;
  }

  const execMatch = quotedBeforeLine ? undefined : content.match(/^@exec(?:[ \t]+)(.*)$/);
  if (execMatch) {
    const token = getCurrentToken(execMatch[1]);
    if (execMatch[1].slice(0, token.start).trim()) {
      return undefined;
    }
    return {
      kind: "alias",
      prefix: token.text.replace(/^"/, ""),
      rangeStart: leading.length + content.length - execMatch[1].length + token.start,
    };
  }

  const cwdMatch = quotedBeforeLine ? undefined : content.match(/^@cwd(?:[ \t]+)(.*)$/);
  if (cwdMatch) {
    const token = getCurrentToken(cwdMatch[1]);
    const pathPrefix = token.text.replace(/^"/, "");
    if (!isPathPrefix(pathPrefix)) {
      return undefined;
    }
    return {
      kind: "path",
      prefix: pathPrefix,
      rangeStart: leading.length + content.length - cwdMatch[1].length + token.start,
      cwd: getCwdBeforeLine(source, lineNumber + 1, defaultCwd),
    };
  }

  if (!quotedBeforeLine && content.startsWith("@")) {
    return undefined;
  }

  const token = getCurrentToken(linePrefix);
  const pathPrefix = token.text.replace(/^"/, "");
  if (!isPathPrefix(pathPrefix)) {
    return undefined;
  }
  return {
    kind: "path",
    prefix: pathPrefix,
    rangeStart: token.start,
    cwd: getCwdBeforeLine(source, lineNumber + 1, defaultCwd),
  };
}

async function listPathCompletions(prefix, cwd, readDirectory = (directory) => fs.promises.readdir(directory, { withFileTypes: true })) {
  if (!prefix || (!path.isAbsolute(prefix) && !cwd)) {
    return [];
  }

  const hasTrailingSeparator = /[\\/]$/.test(prefix);
  const parentPart = hasTrailingSeparator ? prefix : path.dirname(prefix);
  const namePrefix = hasTrailingSeparator ? "" : path.basename(prefix);
  const lookupDirectory = path.isAbsolute(parentPart)
    ? parentPart
    : path.resolve(cwd ?? process.cwd(), parentPart || ".");

  let entries;
  try {
    entries = await readDirectory(lookupDirectory);
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.name.toLocaleLowerCase().startsWith(namePrefix.toLocaleLowerCase()))
    .map((entry) => {
      const candidate = hasTrailingSeparator
        ? `${prefix}${entry.name}`
        : parentPart && parentPart !== "."
          ? path.join(parentPart, entry.name)
          : parentPart === "."
            ? `.${path.sep}${entry.name}`
            : entry.name;
      const isDirectory = entry.isDirectory();
      const insertText = quotePath(`${candidate}${isDirectory ? path.sep : ""}`);
      return insertText === undefined ? undefined : {
        label: entry.name,
        insertText: isDirectory ? insertText.slice(0, -1) : insertText,
        isDirectory,
      };
    })
    .filter(Boolean)
    .sort((left, right) => Number(right.isDirectory) - Number(left.isDirectory)
      || left.label.localeCompare(right.label));
}

function createDropProvider(vscode) {
  return {
    async provideDocumentDropEdits(document, position, dataTransfer) {
      const paths = await getDropPaths(dataTransfer);
      if (paths.length === 0) {
        return undefined;
      }

      const editor = vscode.window.activeTextEditor;
      const selection = editor?.document === document
        ? editor.selections?.find((candidate) => !candidate.isEmpty && candidate.contains(position))
        : undefined;
      const replacementRange = selection ?? undefined;
      const start = replacementRange?.start ?? position;
      const end = replacementRange?.end ?? position;
      const beforeLine = document.lineAt(start.line).text;
      const afterLine = document.lineAt(end.line).text;
      const text = makeDropText(
        paths,
        beforeLine[start.character - 1] ?? "",
        afterLine[end.character] ?? "",
      );
      if (!text) {
        return undefined;
      }
      if (replacementRange) {
        const edit = new vscode.DocumentDropEdit("", "Replace selection with file path");
        const additionalEdit = new vscode.WorkspaceEdit();
        additionalEdit.replace(document.uri, replacementRange, text);
        edit.additionalEdit = additionalEdit;
        return edit;
      }
      return new vscode.DocumentDropEdit(text, "Insert file path");
    },
  };
}

function createCompletionProvider(vscode, getDefaultCwd) {
  return {
    async provideCompletionItems(document, position, token) {
      let defaultCwd;
      try {
        defaultCwd = getDefaultCwd(vscode, document);
      } catch {
        defaultCwd = undefined;
      }

      const source = document.getText();
      const completionContext = getCompletionContext(
        source,
        position.line,
        position.character,
        defaultCwd,
      );
      if (!completionContext) {
        return [];
      }

      const range = new vscode.Range(
        position.line,
        completionContext.rangeStart,
        position.line,
        position.character,
      );

      if (completionContext.kind === "alias") {
        const configuredCommands = vscode.workspace
          .getConfiguration("commandWorkbench", document.uri)
          .get("commands", {});
        const commands = configuredCommands !== null
          && typeof configuredCommands === "object"
          && !Array.isArray(configuredCommands)
          ? configuredCommands
          : {};
        return Object.keys(commands ?? {})
          .filter((alias) => alias.startsWith(completionContext.prefix) && !/["\r\n\t]/.test(alias))
          .sort()
          .map((alias) => {
            const item = new vscode.CompletionItem(alias, vscode.CompletionItemKind?.Value);
            item.insertText = /\s/.test(alias) ? `"${alias}"` : alias;
            item.range = range;
            return item;
          });
      }

      const candidates = await listPathCompletions(completionContext.prefix, completionContext.cwd);
      if (token?.isCancellationRequested) {
        return [];
      }
      return candidates.map((candidate) => {
        const item = new vscode.CompletionItem(candidate.label, candidate.isDirectory
          ? vscode.CompletionItemKind?.Folder
          : vscode.CompletionItemKind?.File);
        item.insertText = candidate.insertText;
        item.range = range;
        item.detail = candidate.isDirectory ? "Directory" : "File";
        item.sortText = candidate.isDirectory ? "0" : "1";
        return item;
      });
    },
  };
}

function registerEditorProviders(vscode, getDefaultCwd) {
  const selector = { language: "argslist" };
  const dropProvider = vscode.languages.registerDocumentDropEditProvider(
    selector,
    createDropProvider(vscode),
    { dropMimeTypes: DROP_MIME_TYPES },
  );
  const completionProvider = vscode.languages.registerCompletionItemProvider(
    selector,
    createCompletionProvider(vscode, getDefaultCwd),
    "@",
    " ",
    "\\",
    "/",
    ".",
  );
  return [dropProvider, completionProvider];
}

module.exports = {
  DROP_MIME_TYPES,
  createCompletionProvider,
  createDropProvider,
  getCompletionContext,
  getDropPaths,
  listPathCompletions,
  makeDropText,
  parseUriList,
  quotePath,
  registerEditorProviders,
};
