const { registerSubmitCommand } = require("./commands/submitCommand");

function activate(context) {
  const vscode = require("vscode");
  context.subscriptions.push(registerSubmitCommand(vscode));
}

module.exports = {
  activate,
};
