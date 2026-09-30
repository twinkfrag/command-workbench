class ArgsListError extends Error {
  constructor(message, { code, line, column } = {}) {
    super(message);
    this.name = "ArgsListError";
    this.code = code ?? "INVALID_ARGS_LIST";
    this.line = line;
    this.column = column;
  }
}

module.exports = { ArgsListError };
