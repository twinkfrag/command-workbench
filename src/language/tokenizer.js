const { ArgsListError } = require("./errors");

function isSeparator(character) {
  return character === " " || character === "\t" || character === "\r" || character === "\n";
}

function advancePosition(character, position) {
  if (character === "\r") {
    position.line += 1;
    position.column = 1;
    position.previousWasCarriageReturn = true;
  } else if (character === "\n") {
    if (!position.previousWasCarriageReturn) {
      position.line += 1;
    }
    position.column = 1;
    position.previousWasCarriageReturn = false;
  } else {
    position.column += 1;
    position.previousWasCarriageReturn = false;
  }
}

function tokenizeArguments(source, { startLine = 1, startColumn = 1, startOffset = 0 } = {}) {
  const tokens = [];
  const position = {
    line: startLine,
    column: startColumn,
    previousWasCarriageReturn: false,
  };
  let value = "";
  let tokenStarted = false;
  let tokenStart;
  let quoted = false;
  let quoteStart;

  const pushToken = () => {
    if (!tokenStarted) {
      return;
    }

    tokens.push({
      value,
      line: tokenStart.line,
      column: tokenStart.column,
      offset: tokenStart.offset,
    });
    value = "";
    tokenStarted = false;
    tokenStart = undefined;
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const currentOffset = startOffset + index;

    if (character === '"') {
      if (!tokenStarted) {
        tokenStarted = true;
        tokenStart = { line: position.line, column: position.column, offset: currentOffset };
      }
      if (!quoted) {
        quoteStart = { line: position.line, column: position.column };
      }
      quoted = !quoted;
    } else if (!quoted && isSeparator(character)) {
      pushToken();
    } else {
      if (!tokenStarted) {
        tokenStarted = true;
        tokenStart = { line: position.line, column: position.column, offset: currentOffset };
      }
      value += character;
    }

    advancePosition(character, position);
  }

  if (quoted) {
    throw new ArgsListError("閉じていない double quote があります。", {
      code: "UNCLOSED_QUOTE",
      line: quoteStart.line,
      column: quoteStart.column,
    });
  }

  pushToken();
  return tokens;
}

module.exports = { tokenizeArguments };
