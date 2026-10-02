const { spawn } = require("node:child_process");
const net = require("node:net");
const readline = require("node:readline");
let activeChild;
process.once("exit", () => activeChild?.kill());
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) {
  process.once(signal, () => process.exit(code));
}

function runStep(step) {
  const env = { ...process.env, ...step.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve) => {
    const child = spawn(step.executablePath, step.argv, {
      cwd: step.cwd, env, shell: false, stdio: "inherit",
    });
    activeChild = child;
    child.once("error", (error) => {
      console.error(`起動できません: ${error.message}`);
      resolve(undefined);
    });
    child.once("close", (code) => { activeChild = undefined; resolve(code ?? undefined); });
  });
}

function waitForEnter() {
  console.log("Enter キーでターミナルを閉じます。");
  // The Job's exit code was already reported through IPC. Exit the display
  // host successfully so VS Code closes it instead of adding an error prompt.
  const close = () => process.exit(0);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.on("data", (data) => { if (/[\r\n]/.test(data.toString())) close(); });
  process.stdin.once("end", close);
  process.stdin.resume();
}

async function main() {
  console.log("Command Workbench: ジョブを開始します。");
  const socket = net.createConnection(process.argv[2]);
  const input = readline.createInterface({ input: socket, crlfDelay: Infinity });
  const job = await new Promise((resolve, reject) => {
    input.once("line", (line) => {
      try { resolve(JSON.parse(line)); } catch (error) { reject(error); }
    });
    socket.once("error", reject);
    socket.once("end", () => reject(new Error("実行キューへの接続が切れました。")));
  });
  input.close();
  let completed = false;
  socket.on("error", () => { if (!completed) process.exit(1); });
  socket.on("close", () => { if (!completed) process.exit(1); });
  let result = { status: "completed" };
  for (let index = 0; index < job.steps.length; index += 1) {
    const step = job.steps[index];
    socket.write(`${JSON.stringify({ type: "step", index })}\n`);
    console.log(`\nStep ${index + 1}/${job.steps.length}: ${[step.executablePath, ...step.argv].map((value) => JSON.stringify(value)).join(" ")}`);
    const exitCode = await runStep(step);
    if (exitCode !== 0) { result = { status: "failed", failedStep: index, exitCode }; break; }
  }
  completed = true;
  console.log(result.status === "completed" ? "\nJob が正常終了しました。"
    : `\nStep ${result.failedStep + 1} が失敗しました（終了コード: ${result.exitCode ?? "不明"}）。`);
  socket.end(`${JSON.stringify({ type: "complete", result })}\n`);
  waitForEnter();
}

main().catch((error) => { console.error(error.message); process.exit(1); });
