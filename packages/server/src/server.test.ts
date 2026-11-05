/** Real-socket tests exercise authority boundaries rather than mocking the transport. */
import { afterEach, beforeEach, it, expect } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";

import { join } from "node:path";
import { CanvasServer } from "./server";
import { HeadlessClient } from "../../../tools/headless-client";
import {
  msg,
  makeElement,
  applyOp,
  emptyBoard,
  stateHash,
} from "../../shared/src/index";
import { createHash } from "node:crypto";
import { SyncEngine } from "../../client/src/sync/SyncEngine";
import { createConnection } from "node:net";
import { Persistence } from "./persistence";
import { encodeFrame } from "../../shared/src/index";
let server: CanvasServer, dir: string;
const clients: HeadlessClient[] = [];
beforeEach(async () => {
  mkdirSync(".runtime", { recursive: true });
  dir = mkdtempSync(join(process.cwd(), ".runtime", "canvas-"));
  server = new CanvasServer({
    host: "127.0.0.1",
    port: 0,
    name: "Test",
    data: dir,
    maxClients: 100,
    discovery: false,
    discoveryPort: 0,
    graceMs: 150,
    heartbeatMs: 5000,
    timeoutMs: 15000,
    logLevel: "error",
  });
  await server.listen();
});
afterEach(async () => {
  for (const c of clients) c.close();
  clients.length = 0;
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});
async function client() {
  const c = await new HeadlessClient().connect(server.port);
  clients.push(c);
  return c;
}
async function room(options: Record<string, unknown> = {}) {
  const a = await client();
  a.send(msg("room_create", { name: "Workshop", username: "Ada", ...options }));
  const joined = await a.wait("join_ok");
  return { a, code: joined.p.code, joined };
}
it("console kick removes sessions immediately and closed rooms stay closed after restart", async () => {
  const { code } = await room();
  const b = await client();
  b.send(msg("room_join", { code, username: "Console target" }));
  const joined = await b.wait("join_ok");
  server.command(`kick ${code} ${joined.p.you.id}`);
  expect(server.rooms.get(code)!.sessions.has(joined.p.you.id)).toBe(false);
  expect(JSON.parse(server.command("stats"))).toHaveProperty("opsPerSecond");
  server.command(`close ${code}`);
  expect(server.rooms.has(code)).toBe(false);
  const config = server.config;
  await server.close();
  server = new CanvasServer(config);
  await server.listen();
  expect(server.rooms.has(code)).toBe(false);
});
it("creates, joins, broadcasts and deduplicates ordered operations", async () => {
  const { a, code } = await room();
  const b = await client();
  b.send(msg("room_join", { code, username: "Ben" }));
  await b.wait("join_ok");
  const op = msg("op", {
    opId: "op1",
    op: { kind: "add", el: makeElement("rect", "r") },
  });
  a.send(op);
  const first = await b.wait("op_applied");
  expect(first.p.seq).toBe(1);
  expect((await a.wait("op_applied")).p.opId).toBe("op1");
  a.send(op);
  expect((await a.wait("op_applied")).p.seq).toBe(1);
  expect(server.rooms.get(code)!.state.seq).toBe(1);
  b.send(msg("sync_req", { fromSeq: 0 }));
  expect((await b.wait("sync_delta")).p.ops).toHaveLength(1);
  b.send(msg("sync_req", { fromSeq: -1 }));
  expect((await b.wait("sync_snapshot")).p.snapshot.elements.r.authorName).toBe(
    "Ada",
  );
});
it("password challenge, approval, duplicate names and viewer rejection", async () => {
  const { a, code } = await room({
    password: "secret",
    settings: { requireApproval: true, defaultRole: "viewer" },
  });
  const b = await client();
  b.send(msg("room_join", { code, username: "Ben" }));
  await b.prove("wrong");
  expect((await b.wait("join_denied")).p.code).toBe("AUTH_FAILED");
  b.send(msg("room_join", { code, username: "Ben" }));
  await b.prove("secret");
  await b.wait("join_pending");
  const request = await a.wait("join_request");
  a.send(msg("join_decide", { pendingId: request.p.pendingId, allow: true }));
  expect((await b.wait("join_ok")).p.you.role).toBe("viewer");
  b.send(msg("op", { opId: "forbidden", op: { kind: "clear" } }));
  expect((await b.wait("op_rejected")).p.code).toBe("READ_ONLY");
  const c = await client();
  c.send(msg("room_join", { code, username: "ada" }));
  expect((await c.wait("error")).p.code).toBe("USERNAME_TAKEN");
});
it("resumes the same identity and recovers state after server restart", async () => {
  const { a, code, joined } = await room();
  a.send(
    msg("op", {
      opId: "persist",
      op: { kind: "add", el: makeElement("sticky", "n") },
    }),
  );
  await a.wait("op_applied");
  a.socket.destroy();
  await new Promise((r) => setTimeout(r, 30));
  const b = await client();
  b.send(
    msg("room_join", {
      code,
      username: "Ada",
      resumeToken: joined.p.resumeToken,
      lastSeq: 0,
    }),
  );
  expect((await b.wait("join_ok")).p.mode).toBe("delta");
  const config = { ...server.config };
  await server.close();
  server = new CanvasServer(config);
  await server.listen();
  expect(server.rooms.get(code)!.state.elements.n).toBeDefined();
});
it("versions restore through a sequenced operation and chat is ordered", async () => {
  const { a, code } = await room();
  a.send(
    msg("op", {
      opId: "add",
      op: { kind: "add", el: makeElement("rect", "r") },
    }),
  );
  await a.wait("op_applied");
  a.send(msg("snap_save", { label: "First" }));
  await a.wait("snap_changed");
  a.send(msg("snap_list", {}));
  const list = await a.wait("snap_list_result");
  a.send(msg("op", { opId: "clear", op: { kind: "clear" } }));
  await a.wait("op_applied");
  a.send(msg("snap_restore", { id: list.p.snapshots[0].id }));
  await a.wait("op_applied");
  expect(server.rooms.get(code)!.state.elements.r).toBeDefined();
  for (let i = 0; i < 5; i++)
    a.send(msg("chat_send", { cid: "c" + i, text: "Message " + i }));
  await new Promise((r) => setTimeout(r, 80));
  expect(
    server.rooms
      .get(code)!
      .chat.filter((c) => !c.system)
      .map((c) => c.text),
  ).toEqual(Array.from({ length: 5 }, (_, i) => "Message " + i));
});
it("ten concurrent TCP senders converge and a late joiner receives the same board", async () => {
  const { a, code } = await room(),
    all = [a];
  for (let i = 1; i < 10; i++) {
    const c = await client();
    c.send(msg("room_join", { code, username: "User " + i }));
    await c.wait("join_ok");
    all.push(c);
  }
  const states = all.map(() => emptyBoard());
  all.forEach((c, i) => {
    c.onMessage = (e) => {
      if (e.t === "op_applied") {
        states[i] = applyOp(states[i], e.p.op, {
          by: e.p.by,
          byName: e.p.byName,
          ts: e.p.ts,
        }).state;
        states[i].seq = e.p.seq;
      }
    };
  });
  all.forEach((c, i) =>
    c.send(
      msg("op", {
        opId: "parallel-" + i,
        op: { kind: "add", el: makeElement("rect", "element-" + i) },
      }),
    ),
  );
  await new Promise((r) => setTimeout(r, 150));
  expect(states.every((s) => s.seq === 10)).toBe(true);
  expect(new Set(states.map(stateHash)).size).toBe(1);
  expect(stateHash(server.rooms.get(code)!.state)).toBe(stateHash(states[0]));
});
it("roles, protected boards, kicks and bans are enforced on the server", async () => {
  const { a, code } = await room(),
    b = await client();
  b.send(msg("room_join", { code, username: "Ben" }));
  const joined = await b.wait("join_ok");
  a.send(msg("settings_update", { patch: { boardLocked: true } }));
  await b.wait("settings_changed");
  b.send(msg("op", { opId: "locked", op: { kind: "clear" } }));
  expect((await b.wait("op_rejected")).p.code).toBe("READ_ONLY");
  a.send(msg("role_set", { userId: joined.p.you.id, role: "viewer" }));
  expect((await b.wait("participant_updated")).p.participant.role).toBe(
    "viewer",
  );
  a.send(msg("kick", { userId: joined.p.you.id, ban: true }));
  expect((await b.wait("bye")).p.reason).toBe("BANNED");
  const c = await client();
  c.send(msg("room_join", { code, username: "Cora" }));
  expect((await c.wait("error")).p.code).toBe("BANNED");
});
it("assets verify their size, digest and file magic before storing", async () => {
  const { a } = await room();
  const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB3sAAAAASUVORK5CYII=",
      "base64",
    ),
    hash = createHash("sha256").update(bytes).digest("hex");
  a.send(msg("asset_have", { hash }));
  expect((await a.wait("asset_have_result")).p.have).toBe(false);
  a.send(
    msg("asset_put", {
      hash,
      mime: "image/png",
      size: bytes.length,
      idx: 0,
      total: 1,
      data: bytes.toString("base64"),
    }),
  );
  await a.wait("asset_put_ok");
  a.send(msg("asset_get", { hash }));
  expect(Buffer.from((await a.wait("asset_chunk")).p.data, "base64")).toEqual(
    bytes,
  );
  a.send(
    msg("asset_put", {
      hash: "a".repeat(64),
      mime: "image/png",
      size: bytes.length,
      idx: 0,
      total: 1,
      data: bytes.toString("base64"),
    }),
  );
  expect((await a.wait("error")).p.code).toBe("BAD_MSG");
});
it("a real-socket SyncEngine drains optimistic pending changes", async () => {
  const { a, joined, code } = await room();
  const replica = new SyncEngine((e) => a.send(e));
  replica.receive(joined);
  a.onMessage = (e) => replica.receive(e);
  replica.submit({ kind: "add", el: makeElement("rect", "optimistic") });
  expect(replica.pending).toHaveLength(1);
  await new Promise((r) => setTimeout(r, 80));
  expect(replica.pending).toHaveLength(0);
  expect(stateHash(replica.confirmed)).toBe(
    stateHash(server.rooms.get(code)!.state),
  );
});
it("blocks password guessing after five failed one-time proofs", async () => {
  const { code } = await room({ password: "secret" }),
    b = await client();
  for (let i = 0; i < 5; i++) {
    b.send(msg("room_join", { code, username: "Ben" }));
    await b.prove("wrong");
    expect((await b.wait("join_denied")).p.code).toBe("AUTH_FAILED");
  }
  b.send(msg("room_join", { code, username: "Ben" }));
  expect((await b.wait("join_denied")).p.code).toBe("LOCKED_OUT");
});
it("rejects malformed frames and closes a slowloris before hello", async () => {
  const socket = createConnection({ host: "127.0.0.1", port: server.port });
  socket.on("error", () => {});
  socket.on("data", () => {});
  await new Promise<void>((resolve) => socket.once("connect", resolve));
  socket.write(Buffer.alloc(4));
  await new Promise<void>((resolve) => socket.once("close", () => resolve()));
  const silent = createConnection({ host: "127.0.0.1", port: server.port });
  silent.on("error", () => {});
  const start = Date.now();
  await new Promise<void>((resolve) => {
    silent.on("data", () => {});
    silent.once("close", () => resolve());
  });
  expect(Date.now() - start).toBeGreaterThanOrEqual(4800);
  expect(Date.now() - start).toBeLessThan(6500);
});
it("prevents path traversal and rejects oversize text at the wire boundary", async () => {
  const store = new Persistence(dir);
  expect(() => store.dir("../outside")).toThrow();
  const { a } = await room();
  a.socket.write(
    encodeFrame({
      v: 1,
      t: "chat_send",
      p: { cid: "long", text: "x".repeat(2001) },
    }),
  );
  expect((await a.wait("error")).p.code).toBe("BAD_MSG");
});
it("enforces chat burst limits and deduplication", async () => {
  const { a, code } = await room();
  for (let i = 0; i < 6; i++)
    a.send(msg("chat_send", { cid: "burst" + i, text: "Message " + i }));
  expect((await a.wait("error")).p.code).toBe("RATE_LIMITED");
  expect(server.rooms.get(code)!.chat.filter((m) => !m.system)).toHaveLength(5);
});
it("orders chat from five concurrent senders and suppresses repeated client ids", async () => {
  const { a, code } = await room(),
    all = [a];
  for (let i = 1; i < 5; i++) {
    const c = await client();
    c.send(msg("room_join", { code, username: "Chat " + i }));
    await c.wait("join_ok");
    all.push(c);
  }
  all.forEach((c, i) => {
    c.send(msg("chat_send", { cid: "chat-" + i, text: "Concurrent " + i }));
    c.send(msg("chat_send", { cid: "chat-" + i, text: "Concurrent " + i }));
  });
  await new Promise((r) => setTimeout(r, 80));
  const history = server.rooms.get(code)!.chat.filter((m) => !m.system);
  expect(history).toHaveLength(5);
  expect(history.every((m, i) => i === 0 || m.ts >= history[i - 1].ts)).toBe(
    true,
  );
});
it("expires disconnected sessions and requires a fresh identity after grace", async () => {
  const { a, code, joined } = await room();
  a.socket.destroy();
  await new Promise((r) => setTimeout(r, 1200));
  const c = await client();
  c.send(
    msg("room_join", {
      code,
      username: "Ada",
      resumeToken: joined.p.resumeToken,
    }),
  );
  const rejoined = await c.wait("join_ok");
  expect(rejoined.p.you.id).not.toBe(joined.p.you.id);
  expect(rejoined.p.mode).toBe("snapshot");
});
