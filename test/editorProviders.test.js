const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");
const manifest = require("../package.json");
const {
  DROP_MIME_TYPES,
  createCompletionProvider,
  createDropProvider,
  getCompletionContext,
  getDropPaths,
  listPathCompletions,
  makeDropText,
  parseUriList,
  registerEditorProviders,
} = require("../src/editor/editorProviders");

test("manifest registers the argslist TextMate grammar", () => {
  assert.deepEqual(manifest.contributes.grammars, [{
    language: "argslist",
    scopeName: "source.argslist",
    path: "./syntaxes/argslist.tmLanguage.json",
  }]);
});

test("drop text quotes paths and inserts separators when needed", () => {
  assert.equal(makeDropText(["D:\\video files\\in.mkv"], " ", ""), '"D:\\video files\\in.mkv"');
  assert.equal(makeDropText(["D:\\a.mkv", "D:\\b.mkv"], "x", "y"), ' "D:\\a.mkv" "D:\\b.mkv" ');
  assert.equal(makeDropText(["D:\\bad\"name.mkv"]), undefined);
});

test("URI list accepts local file URLs, ignores comments and rejects other schemes", () => {
  const first = pathToFileURL(path.resolve("media one.mkv")).href;
  const second = pathToFileURL(path.resolve("media-two.mkv")).href;
  assert.deepEqual(parseUriList(`# comment\r\n${first}\r\nhttps://example.test/movie.mkv\n${second}`), [
    fileURLPath(first),
    fileURLPath(second),
  ]);
});

test("drop provider handles files and Explorer URI lists, deduplicating paths", async () => {
  const droppedPath = path.resolve("drop file.mkv");
  const dataTransfer = new Map([
    ["files", { asFile: () => ({ uri: { scheme: "file", fsPath: droppedPath } }) }],
    ["text/uri-list", { asString: async () => pathToFileURL(droppedPath).href }],
  ]);
  assert.deepEqual(await getDropPaths(dataTransfer), [droppedPath]);
  assert.deepEqual(DROP_MIME_TYPES, ["files", "text/uri-list"]);
});

test("drop provider inserts paths at its position and replaces a selected range", async () => {
  const droppedPath = path.resolve("replacement.mkv");
  const dataTransfer = new Map([[
    "text/uri-list",
    { asString: async () => pathToFileURL(droppedPath).href },
  ]]);
  const replacements = [];
  class DocumentDropEdit {
    constructor(insertText, title) {
      this.insertText = insertText;
      this.title = title;
    }
  }
  class WorkspaceEdit {
    replace(uri, range, newText) {
      replacements.push({ uri, range, newText });
    }
  }
  const document = {
    uri: { scheme: "file", fsPath: path.resolve("input.argslist") },
    lineAt: () => ({ text: "-i old.mkv --tail" }),
  };
  const selection = {
    isEmpty: false,
    start: { line: 0, character: 3 },
    end: { line: 0, character: 10 },
    contains: () => true,
  };
  const vscode = {
    DocumentDropEdit,
    WorkspaceEdit,
    window: { activeTextEditor: { document, selections: [selection] } },
  };

  const edit = await createDropProvider(vscode).provideDocumentDropEdits(
    document,
    { line: 0, character: 6 },
    dataTransfer,
  );

  assert.equal(edit.insertText, "");
  assert.equal(edit.title, "Replace selection with file path");
  assert.deepEqual(replacements, [{
    uri: document.uri,
    range: selection,
    newText: `"${droppedPath}"`,
  }]);
});

test("drop provider inserts a quoted path at a plain cursor", async () => {
  const droppedPath = path.resolve("input file.mkv");
  const dataTransfer = new Map([[
    "text/uri-list",
    { asString: async () => pathToFileURL(droppedPath).href },
  ]]);
  class DocumentDropEdit {
    constructor(insertText, title) {
      this.insertText = insertText;
      this.title = title;
    }
  }
  const document = {
    uri: { scheme: "file", fsPath: path.resolve("input.argslist") },
    lineAt: () => ({ text: "-i " }),
  };
  const vscode = {
    DocumentDropEdit,
    window: { activeTextEditor: { document, selections: [{ isEmpty: true }] } },
  };
  const edit = await createDropProvider(vscode).provideDocumentDropEdits(
    document,
    { line: 0, character: 3 },
    dataTransfer,
  );
  assert.equal(edit.insertText, `"${droppedPath}"`);
  assert.equal(edit.title, "Insert file path");
});

test("completion offers only registered aliases after @exec and suppresses comments", () => {
  const alias = getCompletionContext("@exec ff", 0, 8, "D:\\work");
  assert.deepEqual(alias, { kind: "alias", prefix: "ff", rangeStart: 6 });
  assert.equal(getCompletionContext("  # @exec ff", 0, 12, "D:\\work"), undefined);
  assert.equal(getCompletionContext("@unknown ff", 0, 11, "D:\\work"), undefined);
  assert.equal(getCompletionContext("@exec ff ", 0, 9, "D:\\work"), undefined);
  assert.deepEqual(getCompletionContext("@exec ", 0, 6, "D:\\work"), {
    kind: "alias",
    prefix: "",
    rangeStart: 6,
  });
});

test("path completion uses the effective cwd before the current line", () => {
  const completion = getCompletionContext(
    '@cwd "D:\\assets"\n@exec ffmpeg\n-i ".\\Vid',
    2,
    9,
    "C:\\work",
  );
  assert.deepEqual(completion, {
    kind: "path",
    prefix: ".\\Vid",
    rangeStart: 3,
    cwd: path.resolve("D:\\assets"),
  });
});

test("filesystem completion emits quoted entries and keeps directory quote open", async () => {
  const suggestions = await listPathCompletions("D:\\Vid", "D:\\work", async () => [
    { name: "Videos", isDirectory: () => true },
    { name: "Video.mkv", isDirectory: () => false },
    { name: "Other", isDirectory: () => true },
  ]);
  assert.deepEqual(suggestions, [
    { label: "Videos", insertText: '"D:\\Videos\\', isDirectory: true },
    { label: "Video.mkv", insertText: '"D:\\Video.mkv"', isDirectory: false },
  ]);
});

test("completion provider scopes alias suggestions to configured profiles", async () => {
  class CompletionItem {
    constructor(label, kind) {
      this.label = label;
      this.kind = kind;
    }
  }
  class Range {
    constructor(startLine, startCharacter, endLine, endCharacter) {
      Object.assign(this, { startLine, startCharacter, endLine, endCharacter });
    }
  }
  const vscode = {
    CompletionItem,
    CompletionItemKind: { Value: 1 },
    Range,
    workspace: {
      getConfiguration: () => ({ get: () => ({ ffmpeg: "ffmpeg.exe", ffprobe: "ffprobe.exe", node: "node.exe" }) }),
    },
  };
  const document = {
    uri: { scheme: "file", fsPath: path.resolve("encode.argslist") },
    getText: () => "@exec ff",
  };
  const items = await createCompletionProvider(vscode, () => "D:\\work").provideCompletionItems(
    document,
    { line: 0, character: 8 },
  );
  assert.deepEqual(items.map((item) => item.label), ["ffmpeg", "ffprobe"]);
});

test("editor providers register for argslist with local file drop MIME types", () => {
  const registrations = [];
  const vscode = {
    languages: {
      registerDocumentDropEditProvider: (...args) => {
        registrations.push(["drop", ...args]);
        return { dispose() {} };
      },
      registerCompletionItemProvider: (...args) => {
        registrations.push(["completion", ...args]);
        return { dispose() {} };
      },
    },
  };
  const disposables = registerEditorProviders(vscode, () => "D:\\work");
  assert.equal(disposables.length, 2);
  assert.deepEqual(registrations[0][1], { language: "argslist" });
  assert.deepEqual(registrations[0][3], { dropMimeTypes: ["files", "text/uri-list"] });
  assert.deepEqual(registrations[1][1], { language: "argslist" });
  assert.equal(registrations[1].includes(" "), true);
});

function fileURLPath(value) {
  return require("node:url").fileURLToPath(value);
}
