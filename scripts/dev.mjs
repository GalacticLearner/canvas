/** Start local Vite tooling and Electron; the packaged runtime contains neither HTTP nor Vite. */
import { createServer } from "vite";
import { build } from "esbuild";
import { spawn } from "node:child_process";
import electron from "electron";
await build({
  entryPoints: ["packages/client/electron/main.ts"],
  outfile: "dist/client/main.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
});
await build({
  entryPoints: ["packages/client/electron/preload.ts"],
  outfile: "dist/client/preload.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
});
const server = await createServer({
  root: "packages/client",
  server: { port: 5173, strictPort: true },
});
await server.listen();
const child = spawn(
  electron,
  ["dist/client/main.cjs", ...process.argv.slice(2)],
  { stdio: "inherit", env: { ...process.env, CANVAS_DEV: "1" } },
);
child.on("exit", () => {
  void server.close();
  process.exit();
});
