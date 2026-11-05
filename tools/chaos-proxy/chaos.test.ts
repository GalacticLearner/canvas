/** Fault integration verifies fragmented duplicate frames remain one authoritative operation. */
import { it, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { CanvasServer } from "../../packages/server/src/server";
import { HeadlessClient } from "../headless-client";
import { chaosProxy } from "./index";
import { makeElement, msg } from "../../packages/shared/src/index";
it("survives byte fragmentation, delay and duplicate operation injection", async () => {
  mkdirSync(".runtime", { recursive: true });
  const data = mkdtempSync(join(process.cwd(), ".runtime", "chaos-"));
  const server = new CanvasServer({
    host: "127.0.0.1",
    port: 0,
    name: "Chaos",
    data,
    maxClients: 100,
    discovery: false,
    discoveryPort: 0,
    graceMs: 100,
    heartbeatMs: 5000,
    timeoutMs: 15000,
    logLevel: "error",
  });
  await server.listen();
  const proxy = await chaosProxy({
    port: 0,
    targetPort: server.port,
    fragment: 1,
    latency: 10,
    jitter: 5,
  });
  const c = await new HeadlessClient().connect(proxy.port);
  try {
    c.send(msg("room_create", { name: "Faults", username: "Ada" }));
    const joined = await c.wait("join_ok");
    const op = msg("op", {
      opId: "same",
      op: { kind: "add", el: makeElement("rect", "r") },
    });
    c.send(op);
    c.send(op);
    expect((await c.wait("op_applied")).p.seq).toBe(1);
    expect((await c.wait("op_applied")).p.seq).toBe(1);
    expect(server.rooms.get(joined.p.code)!.state.seq).toBe(1);
  } finally {
    c.close();
    await proxy.close();
    await server.close();
    rmSync(data, { recursive: true, force: true });
  }
});
