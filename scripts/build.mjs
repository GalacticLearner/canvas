/** Build the offline renderer and isolated Electron/main/server bundles. */
import { build } from "esbuild";
import { build as viteBuild } from "vite";
import { copyFileSync } from "node:fs";
await build({
  entryPoints: ["packages/server/src/main.ts"],
  outfile: "dist/server.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
});
await build({
  entryPoints: ["packages/client/electron/main.ts"],
  outfile: "dist/client/main.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  target: "node22",
});
await build({
  entryPoints: ["packages/client/electron/preload.ts"],
  outfile: "dist/client/preload.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
});
await viteBuild({
  root: "packages/client",
  base: "./",
  build: { outDir: "../../dist/client/renderer", emptyOutDir: true },
});
copyFileSync("build/icon.png", "dist/client/icon.png");
