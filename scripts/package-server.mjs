/** Native executable packaging keeps cross-platform builds in CI's native OS jobs. */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
const target =
  process.platform === "win32"
    ? "win-x64"
    : process.platform === "darwin"
      ? "macos-arm64"
      : "linux-x64";
mkdirSync("dist/executables", { recursive: true });
process.env.PKG_CACHE_PATH ||= process.cwd() + "/.runtime/pkg-cache";
execFileSync(
  process.execPath,
  [
    "node_modules/@yao-pkg/pkg/lib-es5/bin.js",
    "dist/server.cjs",
    "--target",
    `node22-${target}`,
    "--output",
    `dist/executables/canvas-server-${target}${process.platform === "win32" ? ".exe" : ""}`,
  ],
  { stdio: "inherit" },
);
