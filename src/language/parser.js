const path = require("node:path");
const { normalizeCommandProfiles } = require("../commands/commandProfiles");
const { ArgsListError } = require("./errors");
const { tokenizeArguments } = require("./tokenizer");

function getPhysicalLines(source) {
  const lines = [];
  let offset = 0;
  let lineNumber = 1;

  while (offset < source.length) {
    let end = offset;
    while (end < source.length && source[end] !== "\r" && source[end] !== "\n") {
      end += 1;
    }

    let newline = "";
    if (end < source.length) {
      newline = source[end] === "\r" && source[end + 1] === "\n" ? "\r\n" : source[end];
    }
    lines.push({
      text: source.slice(offset, end),
      newline,
      offset,
      line: lineNumber,
    });
    offset = end + newline.length;
    lineNumber += 1;
  }

  if (source.length === 0) {
    lines.push({ text: "", newline: "", offset: 0, line: 1 });
  }
  return lines;
}

function updateQuoteState(text, initiallyQuoted) {
  let quoted = initiallyQuoted;
  for (const character of text) {
    if (character === '"') {
      quoted = !quoted;
    }
  }
  return quoted;
}

function resolveCwd(value, currentCwd, location) {
  if (path.isAbsolute(value)) {
    return path.resolve(value);
  }
  if (!currentCwd) {
    throw new ArgsListError("相対 @cwd を解決する基準 directory がありません。", {
      code: "UNRESOLVED_CWD",
      line: location.line,
      column: location.column,
    });
  }
  return path.resolve(currentCwd, value);
}

function getCwdBeforeLine(source, targetLine, defaultCwd) {
  let currentCwd = defaultCwd ? path.resolve(defaultCwd) : undefined;
  let quoted = false;

  for (const line of getPhysicalLines(source)) {
    if (line.line >= targetLine) {
      break;
    }

    const isComment = !quoted && /^\s*#/.test(line.text);
    const isDirective = !quoted && /^\s*@/.test(line.text);
    if (isComment) {
      continue;
    }
    if (isDirective) {
      const leadingWhitespace = line.text.match(/^\s*/)[0].length;
      try {
        const tokens = tokenizeArguments(line.text.slice(leadingWhitespace));
        if (tokens[0]?.value === "@cwd" && tokens.length === 2) {
          currentCwd = resolveCwd(tokens[1].value, currentCwd, tokens[1]);
        }
      } catch {
        currentCwd = undefined;
      }
      continue;
    }

    quoted = updateQuoteState(line.text + line.newline, quoted);
  }

  return currentCwd;
}

function parseArgsList(source, { commands = {}, defaultCwd } = {}) {
  if (typeof source !== "string") {
    throw new TypeError("source must be a string");
  }

  const profiles = normalizeCommandProfiles(commands);
  let currentCwd = defaultCwd ? path.resolve(defaultCwd) : undefined;
  let currentStep;
  const steps = [];
  let argumentBuffer = "";
  let argumentBufferLine = 1;
  let argumentBufferOffset = 0;
  let quoted = false;

  const flushArguments = () => {
    if (argumentBuffer.length === 0) {
      return;
    }

    const tokens = tokenizeArguments(argumentBuffer, {
      startLine: argumentBufferLine,
      startOffset: argumentBufferOffset,
    });
    if (tokens.length > 0 && !currentStep) {
      const token = tokens[0];
      throw new ArgsListError("@exec より前に argument があります。", {
        code: "ARGUMENT_BEFORE_EXEC",
        line: token.line,
        column: token.column,
      });
    }
    if (currentStep) {
      currentStep.argv.push(...tokens.map((token) => token.value));
    }

    argumentBuffer = "";
  };

  for (const line of getPhysicalLines(source)) {
    const isComment = !quoted && /^\s*#/.test(line.text);
    const isDirective = !quoted && /^\s*@/.test(line.text);

    if (isComment || isDirective) {
      flushArguments();
      if (isComment) {
        continue;
      }

      const leadingWhitespace = line.text.match(/^\s*/)[0].length;
      const tokens = tokenizeArguments(line.text.slice(leadingWhitespace), {
        startLine: line.line,
        startColumn: leadingWhitespace + 1,
        startOffset: line.offset + leadingWhitespace,
      });
      const directive = tokens[0]?.value;
      const values = tokens.slice(1);
      if (directive === "@exec") {
        if (values.length !== 1) {
          throw new ArgsListError("@exec には command-profile alias を1つ指定してください。", {
            code: "INVALID_EXEC_DIRECTIVE",
            line: line.line,
            column: leadingWhitespace + 1,
          });
        }
        const alias = values[0].value;
        const profile = profiles.get(alias);
        if (!profile) {
          throw new ArgsListError(`Command Profile "${alias}" は登録されていません。`, {
            code: "UNKNOWN_COMMAND_PROFILE",
            line: values[0].line,
            column: values[0].column,
          });
        }

        currentStep = {
          commandProfile: alias,
          executable: profile.executable,
          cwd: currentCwd,
          argv: [...profile.args],
        };
        steps.push(currentStep);
      } else if (directive === "@cwd") {
        if (values.length !== 1) {
          throw new ArgsListError("@cwd には path を1つ指定してください。空白を含むpathは double quote で囲みます。", {
            code: "INVALID_CWD_DIRECTIVE",
            line: line.line,
            column: leadingWhitespace + 1,
          });
        }
        currentCwd = resolveCwd(values[0].value, currentCwd, values[0]);
      } else {
        throw new ArgsListError(`未対応の directive "${directive ?? ""}" です。`, {
          code: "UNKNOWN_DIRECTIVE",
          line: line.line,
          column: leadingWhitespace + 1,
        });
      }
      continue;
    }

    if (argumentBuffer.length === 0) {
      argumentBufferLine = line.line;
      argumentBufferOffset = line.offset;
    }
    argumentBuffer += line.text + line.newline;
    quoted = updateQuoteState(line.text + line.newline, quoted);
  }
  flushArguments();

  if (steps.length === 0) {
    throw new ArgsListError("実行する Step がありません。@exec を追加してください。", {
      code: "NO_STEPS",
      line: 1,
      column: 1,
    });
  }

  return Object.freeze({
    steps: Object.freeze(steps.map((step) => Object.freeze({
      ...step,
      argv: Object.freeze([...step.argv]),
    }))),
  });
}

module.exports = { getCwdBeforeLine, parseArgsList };
