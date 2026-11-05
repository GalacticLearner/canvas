/** Isolated-process load harness separates server RSS from the headless client driver. */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { HeadlessClient } from "../headless-client";
import { msg, makeElement } from "../../packages/shared/src/index";
const duration = Number(
    process.argv.find((a) => a.startsWith("--seconds="))?.split("=")[1] || 300,
  ),
  count = Number(
    process.argv.find((a) => a.startsWith("--clients="))?.split("=")[1] || 20,
  );
async function main() {
  const port = 16000 + Math.floor(Math.random() * 1000),
    data = ".runtime/load/" + crypto.randomUUID();
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
      "--max-clients",
      "100",
      "--max-per-ip",
      "100",
      "--no-discovery",
    ],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  let serverRssMB = 0,
    output = "";
  server.stdout.on("data", (chunk) => {
    output += chunk;
    const lines = output.split("\n");
    output = lines.pop()!;
    for (const line of lines)
      try {
        serverRssMB = Math.max(serverRssMB, JSON.parse(line).rssMB || 0);
      } catch {
        /* Startup banner is human readable. */
      }
  });
  await new Promise<void>((resolve, reject) => {
    server.stdout.once("data", () => resolve());
    server.once("error", reject);
    server.once("exit", (code) => {
      if (code) reject(new Error("Benchmark server exited " + code));
    });
  });
  const clients: HeadlessClient[] = [],
    latencies: number[] = [],
    starts = new Map<string, number>();
  let bytes = 0,
    code = "";
  try {
    for (let i = 0; i < count; i++) {
      const c = await new HeadlessClient().connect(port);
      clients.push(c);
      c.send(
        i === 0
          ? msg("room_create", {
              name: "Measured benchmark",
              username: "Bot 0",
              settings: { maxParticipants: 100 },
            })
          : msg("room_join", { code, username: "Bot " + i }),
      );
      const joined = await c.wait("join_ok");
      code = joined.p.code;
      c.onMessage = (e) => {
        if (e.t === "op_applied" && i !== 0) {
          const start = starts.get(e.p.opId);
          if (start) latencies.push(performance.now() - start);
        }
      };
    }
    const start = Date.now();
    let n = 0;
    const interval = setInterval(() => {
      const opId = crypto.randomUUID(),
        el = makeElement("stroke", "load-" + n++);
      el.points = Array.from(
        { length: 40 },
        () => Math.round(Math.random() * 1000) / 10,
      );
      const envelope = msg("op", { opId, op: { kind: "add", el } });
      starts.set(opId, performance.now());
      bytes += Buffer.byteLength(JSON.stringify(envelope)) + 4;
      clients[0].send(envelope);
      for (const c of clients) {
        c.send(msg("ping", { n: Date.now() }));
        if (n % 3 === 0)
          c.send(msg("eph", { k: "cursor", d: { x: n % 1000, y: 100 } }));
      }
      if (n % 10 === 0)
        clients[0].send(
          msg("chat_send", {
            cid: crypto.randomUUID(),
            text: "Load test " + n,
          }),
        );
    }, 100);
    await new Promise((resolve) => setTimeout(resolve, duration * 1000));
    clearInterval(interval);
    server.stdin.write("stats\n");
    await new Promise((resolve) => setTimeout(resolve, 200));
    latencies.sort((a, b) => a - b);
    const result = {
      scope:
        "Loopback TCP client-send to other headless client-receive; separate server process; excludes renderer and physical LAN",
      mix: "10 drawing ops/s; cursor from every client ~3.3 Hz; chat 1/s; ping 10/s/client",
      clients: count,
      seconds: (Date.now() - start) / 1000,
      samples: latencies.length,
      p50: latencies[Math.floor(latencies.length * 0.5)],
      p95: latencies[Math.floor(latencies.length * 0.95)],
      p99: latencies[Math.floor(latencies.length * 0.99)],
      drawingUpstreamBytesPerSecond: bytes / duration,
      serverRssMB,
      driverRssMB: process.memoryUsage().rss / 1048576,
    };
    mkdirSync("dist/evidence", { recursive: true });
    writeFileSync(
      `dist/evidence/load-isolated-${count}-${duration}.json`,
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    clients.forEach((c) => c.close());
    server.stdin.write("quit\n");
    await new Promise((resolve) => server.once("exit", resolve));
  }
}
void main();
