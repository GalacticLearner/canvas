/** Phase 3 gate runs real TCP replicas for one minute and records convergence evidence. */
import { mkdirSync, writeFileSync } from "node:fs";
import { CanvasServer } from "../../packages/server/src/server";
import { HeadlessClient } from "../headless-client";
import { SyncEngine } from "../../packages/client/src/sync/SyncEngine";
import { msg, makeElement, stateHash } from "../../packages/shared/src/index";
async function main() {
  const data = ".runtime/convergence/" + crypto.randomUUID();
  mkdirSync(data, { recursive: true });
  const server = new CanvasServer({
    host: "127.0.0.1",
    port: 0,
    name: "Convergence gate",
    data,
    maxClients: 100,
    maxPerIp: 100,
    discovery: false,
    discoveryPort: 0,
    graceMs: 120000,
    heartbeatMs: 5000,
    timeoutMs: 15000,
    logLevel: "error",
  });
  await server.listen();
  const clients: HeadlessClient[] = [],
    replicas: SyncEngine[] = [];
  let code = "",
    accepted = 0;
  try {
    for (let i = 0; i < 10; i++) {
      const c = await new HeadlessClient().connect(server.port);
      clients.push(c);
      const engine = new SyncEngine((e) => c.send(e));
      replicas.push(engine);
      c.send(
        i
          ? msg("room_join", { code, username: "Bot " + i })
          : msg("room_create", { name: "Convergence", username: "Bot 0" }),
      );
      const joined = await c.wait("join_ok");
      code = joined.p.code;
      engine.receive(joined);
      c.onMessage = (e) => {
        engine.receive(e);
        if (e.t === "op_applied" && i === 0) accepted++;
      };
    }
    const started = Date.now();
    let n = 0;
    const timer = setInterval(() => {
      const i = n++ % 10,
        engine = replicas[i],
        ids = Object.keys(engine.view.elements);
      if (ids.length && Math.random() < 0.5) {
        const id = ids[Math.floor(Math.random() * ids.length)];
        engine.submit({
          kind: "patch",
          id,
          set: { x: Math.round(Math.random() * 1000) },
        });
      } else {
        const el = makeElement("stroke", crypto.randomUUID());
        el.points = [
          Math.random() * 1000,
          Math.random() * 800,
          Math.random() * 1000,
          Math.random() * 800,
        ];
        engine.submit({ kind: "add", el });
      }
      if (n % 20 === 0)
        for (const c of clients) c.send(msg("ping", { n: Date.now() }));
    }, 50);
    await new Promise((resolve) => setTimeout(resolve, 60000));
    clearInterval(timer);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const hashes = replicas.map((r) => stateHash(r.confirmed));
    if (
      new Set(hashes).size !== 1 ||
      hashes[0] !== stateHash(server.rooms.get(code)!.state) ||
      replicas.some((r) => r.pending.length)
    )
      throw new Error("Replicas did not converge");
    const result = {
      clients: 10,
      seconds: (Date.now() - started) / 1000,
      accepted,
      seq: server.rooms.get(code)!.state.seq,
      hashes,
      pending: replicas.map((r) => r.pending.length),
    };
    mkdirSync("dist/evidence", { recursive: true });
    writeFileSync(
      "dist/evidence/convergence-10-60.json",
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    clients.forEach((c) => c.close());
    await server.close();
  }
}
void main();
