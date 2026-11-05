/** Dedicated large-board benchmark measures TCP join, isolated-server RSS and real Electron frame pacing. */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { _electron as electron } from "playwright";
import { HeadlessClient } from "../headless-client";
import { emptyBoard, makeElement, msg } from "../../packages/shared/src/index";
async function main() {
  const data = ".runtime/perf/" + crypto.randomUUID(),
    port = 16850;
  mkdirSync(data, { recursive: true });
  const server = spawn(
    process.execPath,
    [
      "dist/server.cjs",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--data",
      data,
      "--max-per-ip",
      "100",
      "--no-discovery",
    ],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  let serverRssMB = 0;
  server.stdout.on("data", (chunk) => {
    for (const line of chunk.toString().split("\n"))
      try {
        serverRssMB = Math.max(serverRssMB, JSON.parse(line).rssMB || 0);
      } catch {
        /* Startup address banner is not a stats record. */
      }
  });
  await new Promise<void>((resolve, reject) => {
    server.stdout.once("data", () => resolve());
    server.once("error", reject);
  });
  const clients: HeadlessClient[] = [];
  let app: any;
  const beat = setInterval(
    () => clients.forEach((c) => c.send(msg("ping", { n: Date.now() }))),
    5000,
  );
  try {
    const board = emptyBoard();
    for (let i = 0; i < 5000; i++) {
      const x = (i % 100) * 80,
        y = Math.floor(i / 100) * 50,
        el = makeElement("stroke", "perf-" + i, x, y);
      el.points = Array.from({ length: 20 }, (_, j) => [
        x + j * 3,
        y + Math.sin(j / 3) * 12,
      ]).flat();
      board.elements[el.id] = el;
    }
    let code = "";
    for (let i = 0; i < 10; i++) {
      if (i >= 4) await new Promise((r) => setTimeout(r, 5100));
      const c = await new HeadlessClient().connect(port);
      clients.push(c);
      c.send(
        msg("room_create", {
          name: "5000 strokes " + i,
          username: "Owner " + i,
        }),
      );
      code = (await c.wait("join_ok")).p.code;
      c.send(
        msg("op", {
          opId: crypto.randomUUID(),
          op: { kind: "replace_state", state: board },
        }),
      );
      await c.wait("op_applied", 20000);
      console.log("Large board ready", i + 1);
    }
    const late = await new HeadlessClient().connect(port);
    clients.push(late);
    const start = performance.now();
    late.send(msg("room_join", { code, username: "Late join" }));
    const joined = await late.wait("join_ok", 10000);
    const joinMs = performance.now() - start;
    server.stdin.write("stats\n");
    await new Promise((r) => setTimeout(r, 100));
    app = await electron.launch({
      args: [
        "dist/client/main.cjs",
        "--user-data-dir=" + resolve(data + "/renderer"),
      ],
      timeout: 60000,
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    await page
      .getByRole("heading", { name: "Bring everyone to the board." })
      .waitFor();
    await page.evaluate((options: any) => window.canvas.connect(options), {
      host: "127.0.0.1",
      port,
      code,
      username: "Renderer",
      mode: "join",
    });
    await page.getByRole("navigation", { name: "Drawing tools" }).waitFor();
    await page.waitForTimeout(300);
    const frames = await page.evaluate(async () => {
      const longTasks: number[] = [];
      const observer = new PerformanceObserver((list) =>
        longTasks.push(...list.getEntries().map((e) => e.duration)),
      );
      observer.observe({ type: "longtask" });
      const samples: number[] = [];
      let last = performance.now();
      for (let i = 0; i < 130; i++) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame((now) => {
            if (i > 10) samples.push(now - last);
            last = now;
            const canvas = document.querySelector("canvas[aria-label]")!;
            canvas.dispatchEvent(
              new WheelEvent("wheel", {
                deltaY: i % 2 ? -2 : 2,
                clientX: 500,
                clientY: 350,
                bubbles: true,
                cancelable: true,
              }),
            );
            resolve();
          }),
        );
      }
      observer.disconnect();
      return { samples, longTasks };
    });
    const sorted = [...frames.samples].sort((a, b) => a - b),
      result = {
        scope:
          "5000 twenty-point strokes per room; ten active rooms; actual Electron wheel zoom over visible culled strokes",
        rooms: 10,
        elementsPerRoom: 5000,
        joinMs,
        joinedElements: Object.keys(joined.p.snapshot.elements).length,
        serverRssMB,
        rendererFps:
          1000 /
          (frames.samples.reduce((a: number, b: number) => a + b, 0) /
            frames.samples.length),
        frameP95Ms: sorted[Math.floor(sorted.length * 0.95)],
        rendererLongTasks: frames.longTasks,
      };
    mkdirSync("dist/evidence", { recursive: true });
    writeFileSync(
      "dist/evidence/large-board.json",
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    clearInterval(beat);
    if (app) await app.close();
    clients.forEach((c) => c.close());
    server.stdin.write("quit\n");
    await new Promise((resolve) => server.once("exit", resolve));
  }
}
void main();
