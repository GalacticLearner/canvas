/** Exercise the documented demo seeder against a real in-process authority. */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { CanvasServer } from "../../packages/server/src/server.ts";
import { HeadlessClient } from "../headless-client/index.ts";
import { msg } from "../../packages/shared/src/index.ts";
const data = ".runtime/demo-check/" + crypto.randomUUID();
mkdirSync(data, { recursive: true });
const server = new CanvasServer({ host: "127.0.0.1", port: 0, name: "Demo", data, maxClients: 100, maxPerIp: 100, discovery: false, discoveryPort: 0, graceMs: 120000, heartbeatMs: 5000, timeoutMs: 15000, logLevel: "error" });
await server.listen();
const seeder = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "tools/seed/index.ts", "--server", `127.0.0.1:${server.port}`, "--bots", "2"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
try {
  let output = "";
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Seeder did not create a room within 20 seconds")), 20000);
    seeder.stdout.on("data", (chunk) => { output += chunk; const match = output.match(/Room ([ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6})/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    seeder.stderr.on("data", (chunk) => { output += chunk; });
    seeder.once("error", reject);
    seeder.once("exit", (status) => { if (status) reject(new Error(`Seeder exited ${status}: ${output}`)); });
  });
  await new Promise((resolve) => setTimeout(resolve, 2400));
  const room = server.rooms.get(code);
  if (!room) throw new Error("Seeded room was not created");
  const elements = Object.values(room.state.elements), types = [...new Set(elements.map((el) => el.type))];
  if (!types.includes("image") || !types.includes("stroke") || !types.includes("mindnode") || !types.includes("frame")) throw new Error("Demo content is missing an extra-credit element type");
  if (room.sessions.size !== 3 || room.state.seq < 3) throw new Error("Both drawing bots did not join and contribute");
  const verifier = await new HeadlessClient().connect(server.port);
  verifier.send(msg("room_join", { code, username: "Seeder verification" }));
  const joined = await verifier.wait("join_ok"); verifier.close();
  if (Object.keys(joined.p.snapshot.elements).length !== elements.length) throw new Error("Late joiner did not receive the seeded board");
  const result = { room: code, elementCount: elements.length, types, bots: 2, totalSequencedOps: room.state.seq, chatSeeded: room.chat.some((entry) => entry.text.includes("seeded")), lateJoinElements: Object.keys(joined.p.snapshot.elements).length };
  mkdirSync("dist/evidence", { recursive: true }); writeFileSync("dist/evidence/demo.json", JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally { seeder.kill(); await server.close(); }
