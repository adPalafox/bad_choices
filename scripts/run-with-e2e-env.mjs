import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const cwd = process.cwd();
const envPath = path.join(cwd, ".env.e2e");
const command = process.argv.slice(2).join(" ").trim();

if (!command) {
  console.error("Expected a command to run with e2e env variables.");
  process.exit(1);
}

function parseEnvFile(contents) {
  const entries = {};

  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    entries[key] = value;
  }

  return entries;
}

const mergedEnv = {
  ...process.env,
  ...(fs.existsSync(envPath) ? parseEnvFile(fs.readFileSync(envPath, "utf8")) : {})
};

const child = spawn(command, {
  cwd,
  env: mergedEnv,
  shell: true,
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

