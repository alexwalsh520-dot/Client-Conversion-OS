import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(__dirname);

execFileSync(
  "/Users/matthew_conder/.local/node-v22.14.0-darwin-arm64/bin/node",
  ["node_modules/.bin/next", "dev", "--webpack", "--port", "3000"],
  { cwd: __dirname, stdio: "inherit" }
);
