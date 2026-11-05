/** LAN authority coordinates TCP sessions, permissions, persistence and recovery without HTTP. */
import { createServer, type Server } from "node:net";
import { createSocket, type Socket as UdpSocket } from "node:dgram";
import { randomInt, randomBytes, createHash } from "node:crypto";
import { networkInterfaces } from "node:os";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { Connection } from "./connection";
import { Room, type Session, type Applied, type Snapshot } from "./room";
import { Persistence } from "./persistence";
import { nonce, passwordRecord, verifyProof } from "./auth";
import type { ServerConfig } from "./config";
import {
  msg,
  LIMITS,
  IDENTITY_COLORS,
  applyOp,
  can,
  stateHash,
  ProtocolError,
  boardSchema,
  opSchema,
  type Envelope,
  type Op,
} from "../../shared/src/index";
interface Pending {
  connection: Connection;
  room: Room;
  username: string;
  nonce?: string;
  verified: boolean;
  ownerKey?: string;
  timer: ReturnType<typeof setTimeout>;
}
/** Reusable token bucket limits sustained traffic while tolerating gesture bursts. */
class Bucket {
  tokens: number;
  last = Date.now();
  constructor(
    private rate: number,
    private capacity: number,
  ) {
    this.tokens = capacity;
  }
  take() {
    const now = Date.now();
    this.tokens = Math.min(
      this.capacity,
      this.tokens + ((now - this.last) * this.rate) / 1000,
    );
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }
}
/** A server instance owns all timers/listeners and supports deterministic test teardown. */
export class CanvasServer {
  readonly id = crypto.randomUUID();
  readonly rooms = new Map<string, Room>();
  readonly connections = new Set<Connection>();
  readonly persistence: Persistence;
  private tcp: Server;
  private udp?: UdpSocket;
  private timer: ReturnType<typeof setInterval>;
  private pending = new Map<string, Pending>();
  private buckets = new Map<string, Bucket>();
  private failures = new Map<string, { count: number; until: number }>();
  private uploads = new Map<
    string,
    {
      parts: Buffer[];
      size: number;
      mime: string;
      total: number;
      until: number;
    }
  >();
  private closing = false;
  private statsAt = Date.now();
  private statsOps = 0;
  opCount = 0;
  constructor(public config: ServerConfig) {
    this.persistence = new Persistence(config.data);
    this.recover();
    this.tcp = createServer((socket) => {
      if (
        this.connections.size >= config.maxClients ||
        [...this.connections].filter((c) => c.ip === socket.remoteAddress)
          .length >= (config.maxPerIp || 20)
      ) {
        socket.destroy();
        return;
      }
      const c = new Connection(
        socket,
        (conn, e) => this.handle(conn, e),
        (conn) => this.disconnected(conn),
      );
      this.connections.add(c);
    });
    this.timer = setInterval(() => this.tick(), 1000);
  }
  /** Start the TCP listener and optional UDP discovery responder. */
  async listen() {
    await new Promise<void>((resolve, reject) => {
      this.tcp.once("error", reject);
      this.tcp.listen(this.config.port, this.config.host, () => {
        this.tcp.off("error", reject);
        resolve();
      });
    });
    if (this.config.discovery) {
      this.udp = createSocket({ type: "udp4", reuseAddr: true });
      this.udp.on("error", (e) =>
        console.warn("Discovery unavailable:", e.message),
      );
      this.udp.on("message", (data, remote) => {
        if (data.toString() === "WB_DISCOVER/1") {
          const payload = JSON.stringify({
            name: this.config.name,
            tcpPort: this.port,
            rooms: this.rooms.size,
            version: "1",
          });
          this.udp?.send(payload, remote.port, remote.address);
        }
      });
      this.udp.bind(this.config.discoveryPort);
    }
    return this.port;
  }
  /** Bound port is discoverable when tests requested port zero. */
  get port() {
    const address = this.tcp.address();
    return typeof address === "object" && address ? address.port : 0;
  }
  /** Printable addresses are derived locally; runtime never contacts an external host. */
  addresses() {
    return Object.values(networkInterfaces())
      .flat()
      .filter((i) => i?.family === "IPv4")
      .map((i) => `${i!.address}:${this.port}`);
  }
  /** Flush every dirty room before destroying connections and listeners. */
  async close() {
    if (this.closing) return;
    this.closing = true;
    clearInterval(this.timer);
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    for (const room of this.rooms.values()) this.persist(room);
    for (const c of this.connections) c.socket.destroy();
    this.udp?.close();
    await new Promise<void>((resolve) => this.tcp.close(() => resolve()));
  }
  private rate(key: string, rate = 200, burst = 400) {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new Bucket(rate, burst);
      this.buckets.set(key, bucket);
    }
    if (!bucket.take())
      throw new ProtocolError("RATE_LIMITED", "Please slow down");
  }
  private error(c: Connection, e: unknown, opId?: string) {
    const code = e instanceof ProtocolError ? e.code : "BAD_MSG";
    const message = e instanceof ProtocolError ? e.message : "Invalid request";
    c.send(
      opId
        ? msg("op_rejected", { opId, code, message })
        : msg("error", { code, message }),
    );
  }
  private room(c: Connection) {
    const room = this.rooms.get(c.room);
    if (!room || !room.sessions.has(c.userId))
      throw new ProtocolError("DENIED", "Join a room first");
    return room;
  }
  private require(c: Connection, action: Parameters<typeof can>[1]) {
    const room = this.room(c),
      session = room.sessions.get(c.userId)!;
    if (!can(session.participant.role, action, room.settings))
      throw new ProtocolError(
        action === "draw" ? "READ_ONLY" : "FORBIDDEN",
        "Your role does not allow this action",
      );
    return room;
  }
  private handle(c: Connection, e: Envelope) {
    try {
      if (c.state === "new") {
        if (e.t !== "hello")
          throw new ProtocolError("BAD_MSG", "hello must be the first message");
        clearTimeout(c.helloTimer);
        c.clientId = e.p.clientId;
        c.identityColorHint = e.p.identityColorHint || "";
        c.state = "lobby";
        c.send(
          msg("hello_ack", {
            serverId: this.id,
            serverName: this.config.name,
            serverTime: Date.now(),
            hbIntervalMs: this.config.heartbeatMs,
            hbTimeoutMs: this.config.timeoutMs,
            limits: LIMITS,
          }),
        );
        return;
      }
      this.rate(c.id + ":wire", 500, 1000);
      if (e.t === "ping") {
        c.send(msg("pong", e.p));
        return;
      }
      if (e.t === "pong") return;
      if (e.t === "bye" || e.t === "room_leave") {
        this.leave(c, true);
        if (e.t === "bye") c.close("Goodbye");
        return;
      }
      if (e.t === "room_create") {
        this.create(c, e.p);
        return;
      }
      if (e.t === "room_join") {
        this.beginJoin(c, e.p);
        return;
      }
      if (e.t === "auth_proof") {
        this.proof(c, e.p.proof);
        return;
      }
      const room = this.room(c);
      room.lastActive = Date.now();
      switch (e.t) {
        case "join_decide": {
          this.require(c, "manage");
          const p = this.pending.get(e.p.pendingId);
          if (p && p.room === room) {
            if (e.p.allow) this.finishJoin(p);
            else this.deny(p, "DENIED", "The owner declined your request");
          }
          break;
        }
        case "op":
          this.commit(c, room, e.p.opId, e.p.op);
          break;
        case "sync_req":
          this.sync(c, room, e.p.fromSeq);
          break;
        case "eph": {
          this.rate(c.id + ":eph", 60, 90);
          if (
            [
              "cursor",
              "stroke_preview",
              "shape_preview",
              "drag_preview",
              "viewport",
              "laser",
            ].includes(e.p.k)
          ) {
            const now = Date.now(),
              last = c.lastEphemeral.get(e.p.k) || 0;
            if (now - last < 33) break;
            c.lastEphemeral.set(e.p.k, now);
          }
          if (
            room.sessions.get(c.userId)!.participant.role === "viewer" &&
            !["cursor", "viewport"].includes(e.p.k)
          )
            throw new ProtocolError(
              "FORBIDDEN",
              "Viewers can share cursors only",
            );
          if (Buffer.byteLength(JSON.stringify(e.p.d)) > 128000)
            throw new ProtocolError("TOO_LARGE", "Preview too large");
          if (e.p.k === "editing") {
            const id = e.p.d.id;
            const lock = room.locks.get(id);
            if (lock && lock.until > Date.now() && lock.by !== c.userId)
              throw new ProtocolError(
                "DENIED",
                "Someone else is editing this element",
              );
            if (e.p.d.active)
              room.locks.set(id, { by: c.userId, until: Date.now() + 30000 });
            else room.locks.delete(id);
          }
          room.broadcast(msg("eph", { ...e.p, by: c.userId }), c.userId);
          break;
        }
        case "chat_send": {
          this.require(c, "chat");
          this.rate(c.id + ":chat", 5, 5);
          if (room.chatIds.has(e.p.cid)) break;
          room.chatIds.add(e.p.cid);
          while (room.chatIds.size > 1000)
            room.chatIds.delete(room.chatIds.values().next().value!);
          this.chat(
            room,
            c.userId,
            room.sessions.get(c.userId)!.participant.username,
            e.p.text,
            e.p.cid,
          );
          break;
        }
        case "role_set": {
          this.require(c, "manage");
          const target = room.sessions.get(e.p.userId);
          if (!target || target.participant.role === "owner")
            throw new ProtocolError("FORBIDDEN", "Cannot change owner role");
          target.participant.role = e.p.role;
          this.chat(
            room,
            "system",
            "Canvas",
            `${target.participant.username} is now ${e.p.role}`,
            crypto.randomUUID(),
            true,
          );
          room.broadcast(
            msg("participant_updated", { participant: target.participant }),
          );
          room.dirty = true;
          break;
        }
        case "owner_transfer": {
          this.require(c, "manage");
          const target = room.sessions.get(e.p.userId);
          if (!target)
            throw new ProtocolError("NOT_FOUND", "Participant unavailable");
          room.sessions.get(c.userId)!.participant.role = "editor";
          target.participant.role = "owner";
          room.ownerKey = randomBytes(32).toString("hex");
          target.connection?.send(
            msg(
              "join_ok",
              this.joinPayload(room, target, undefined, room.ownerKey),
            ),
          );
          for (const s of room.sessions.values())
            room.broadcast(
              msg("participant_updated", { participant: s.participant }),
            );
          room.dirty = true;
          break;
        }
        case "kick": {
          this.require(c, "manage");
          const target = room.sessions.get(e.p.userId);
          if (!target || target.participant.role === "owner")
            throw new ProtocolError("FORBIDDEN", "Cannot remove owner");
          if (e.p.ban)
            room.bans.push({ clientId: target.clientId, ip: target.ip });
          const conn = target.connection;
          if (conn) {
            this.leave(conn, true);
            conn.close(e.p.ban ? "BANNED" : "Kicked by owner");
          } else room.sessions.delete(target.participant.id);
          room.dirty = true;
          break;
        }
        case "settings_update": {
          this.require(c, "manage");
          const { password, ...patch } = e.p.patch;
          room.settings = { ...room.settings, ...patch };
          if (password !== undefined) {
            room.password = password ? passwordRecord(password) : undefined;
            room.settings.passwordProtected = !!room.password;
          }
          room.broadcast(msg("settings_changed", { settings: room.settings }));
          room.dirty = true;
          break;
        }
        case "snap_save": {
          this.require(c, "save");
          this.snapshot(room, e.p.label, c.userId, false, e.p.thumb);
          break;
        }
        case "snap_list":
          c.send(
            msg("snap_list_result", {
              snapshots: room.snapshots.map(
                ({ state: _state, ...meta }) => meta,
              ),
            }),
          );
          break;
        case "snap_get": {
          const snap = room.snapshots.find((s) => s.id === e.p.id);
          if (!snap)
            throw new ProtocolError("NOT_FOUND", "Version unavailable");
          c.send(
            msg("snap_data", {
              id: snap.id,
              state: this.snapshotState(room, snap),
            }),
          );
          break;
        }
        case "snap_restore": {
          this.require(c, "restore");
          const snap = room.snapshots.find((s) => s.id === e.p.id);
          if (!snap)
            throw new ProtocolError("NOT_FOUND", "Version unavailable");
          this.commit(
            c,
            room,
            crypto.randomUUID(),
            { kind: "replace_state", state: this.snapshotState(room, snap) },
            true,
          );
          break;
        }
        case "snap_delete": {
          this.require(c, "deleteVersion");
          const deleted = room.snapshots.find((s) => s.id === e.p.id);
          if (deleted)
            this.persistence.remove(
              room.code,
              "snapshots/" + deleted.id + ".json",
            );
          room.snapshots = room.snapshots.filter((s) => s.id !== e.p.id);
          room.dirty = true;
          room.broadcast(msg("snap_changed", {}));
          break;
        }
        case "asset_have":
          c.send(
            msg("asset_have_result", {
              hash: e.p.hash,
              have: existsSync(this.assetPath(room, e.p.hash)),
            }),
          );
          break;
        case "asset_put":
          this.upload(c, room, e.p);
          break;
        case "asset_get":
          this.download(c, room, e.p.hash);
          break;
        case "present_set": {
          this.require(c, "present");
          room.present = {
            ...e.p,
            presenterId: e.p.active ? c.userId : undefined,
          };
          room.broadcast(msg("present_state", room.present));
          break;
        }
        default:
          throw new ProtocolError(
            "BAD_MSG",
            "Message is not allowed in this direction",
          );
      }
    } catch (error) {
      this.error(c, error, e.t === "op" ? e.p.opId : undefined);
    }
  }
  private create(c: Connection, p: any) {
    if (c.room)
      throw new ProtocolError("DENIED", "Leave the current room first");
    this.rate(c.ip + ":create", 0.2, 4);
    let code = "";
    do {
      code = Array.from(
        { length: 6 },
        () => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[randomInt(30)],
      ).join("");
    } while (this.rooms.has(code));
    const room = new Room(code, p.name);
    room.settings = {
      ...room.settings,
      ...p.settings,
      name: p.name,
      passwordProtected: !!p.password,
    };
    if (p.password) room.password = passwordRecord(p.password);
    this.rooms.set(code, room);
    const pending = this.makePending(c, room, p.username);
    this.finishJoin(pending, "owner");
    this.persist(room);
  }
  private username(room: Room, input: string, exclude?: string) {
    const name = input.trim();
    if (!name || name.length > 24 || /[\u0000-\u001f\u007f]/.test(name))
      throw new ProtocolError(
        "BAD_MSG",
        "Use a name of 1–24 printable characters",
      );
    if (
      room
        .roster()
        .some(
          (p) =>
            p.id !== exclude && p.username.toLowerCase() === name.toLowerCase(),
        )
    )
      throw new ProtocolError("USERNAME_TAKEN", "That name is already in use");
    return name;
  }
  private makePending(
    c: Connection,
    room: Room,
    username: string,
    ownerKey?: string,
  ) {
    const name = this.username(room, username);
    const pending: Pending = {
      connection: c,
      room,
      username: name,
      verified: false,
      ownerKey,
      timer: setTimeout(() => {
        const p = this.pending.get(c.id);
        if (p) this.deny(p, "DENIED", "Join request timed out");
      }, 30000),
    };
    this.pending.set(c.id, pending);
    return pending;
  }
  private beginJoin(c: Connection, p: any) {
    if (c.room)
      throw new ProtocolError("DENIED", "Leave the current room first");
    this.rate(c.ip + ":join", 2, this.config.maxPerIp || 10);
    const room = this.rooms.get(p.code);
    if (!room)
      throw new ProtocolError("ROOM_NOT_FOUND", "Room code was not found");
    if (room.bans.some((b) => b.clientId === c.clientId || b.ip === c.ip))
      throw new ProtocolError("BANNED", "You cannot join this room");
    if (p.resumeToken) {
      const session = room.sessionByToken(p.resumeToken);
      if (session && (!session.expires || session.expires > Date.now())) {
        session.connection?.socket.destroy();
        session.connection = c;
        session.expires = undefined;
        session.participant.status = "online";
        c.room = room.code;
        c.userId = session.participant.id;
        c.state = "joined";
        c.send(msg("join_ok", this.joinPayload(room, session, p.lastSeq)));
        room.broadcast(
          msg("participant_updated", { participant: session.participant }),
          c.userId,
        );
        return;
      }
    }
    if (room.sessions.size >= room.settings.maxParticipants)
      throw new ProtocolError("ROOM_FULL", "This room is full");
    const pending = this.makePending(c, room, p.username, p.ownerKey);
    if (p.ownerKey === room.ownerKey) {
      this.finishJoin(pending, "owner");
      return;
    }
    if (room.password) {
      const failure = this.failures.get(c.ip);
      if (failure && failure.count >= 5 && failure.until > Date.now()) {
        this.deny(pending, "LOCKED_OUT", "Try again in one minute");
        return;
      }
      pending.nonce = nonce();
      c.send(
        msg("auth_challenge", {
          salt: room.password.salt,
          nonce: pending.nonce,
          kdf: { N: 16384, r: 8, p: 1 },
        }),
      );
    } else this.approve(pending);
  }
  private proof(c: Connection, proof: string) {
    const pending = this.pending.get(c.id);
    if (!pending?.nonce || !pending.room.password)
      throw new ProtocolError(
        "AUTH_REQUIRED",
        "No password challenge is pending",
      );
    const challenge = pending.nonce;
    pending.nonce = undefined;
    if (!verifyProof(pending.room.password, challenge, proof)) {
      const old = this.failures.get(c.ip);
      this.failures.set(c.ip, {
        count: old && old.until > Date.now() ? old.count + 1 : 1,
        until: Date.now() + 60000,
      });
      this.deny(pending, "AUTH_FAILED", "The room password is incorrect");
      return;
    }
    pending.verified = true;
    this.approve(pending);
  }
  private approve(p: Pending) {
    if (p.room.settings.requireApproval) {
      p.connection.send(msg("join_pending", {}));
      for (const s of p.room.sessions.values())
        if (s.participant.role === "owner")
          s.connection?.send(
            msg("join_request", {
              pendingId: p.connection.id,
              username: p.username,
            }),
          );
    } else this.finishJoin(p);
  }
  private deny(
    p: Pending,
    code: "DENIED" | "AUTH_FAILED" | "LOCKED_OUT",
    message: string,
  ) {
    clearTimeout(p.timer);
    this.pending.delete(p.connection.id);
    p.connection.send(msg("join_denied", { code, message }));
  }
  private finishJoin(p: Pending, role?: "owner") {
    const { connection: c, room } = p;
    this.username(room, p.username);
    clearTimeout(p.timer);
    this.pending.delete(c.id);
    if (role === "owner")
      for (const s of room.sessions.values())
        if (s.participant.role === "owner") {
          s.participant.role = "editor";
          room.broadcast(
            msg("participant_updated", { participant: s.participant }),
          );
        }
    const session: Session = {
      participant: {
        id: crypto.randomUUID(),
        username: p.username,
        role: role || room.settings.defaultRole,
        color:
          (IDENTITY_COLORS.includes(c.identityColorHint) &&
          !room.roster().some((p) => p.color === c.identityColorHint)
            ? c.identityColorHint
            : IDENTITY_COLORS.find(
                (color) => !room.roster().some((p) => p.color === color),
              )) ||
          IDENTITY_COLORS[room.sessions.size % IDENTITY_COLORS.length],
        status: "online",
      },
      token: randomBytes(32).toString("hex"),
      clientId: c.clientId,
      ip: c.ip,
      connection: c,
    };
    room.sessions.set(session.participant.id, session);
    c.room = room.code;
    c.userId = session.participant.id;
    c.state = "joined";
    c.send(
      msg(
        "join_ok",
        this.joinPayload(
          room,
          session,
          undefined,
          role === "owner" ? room.ownerKey : undefined,
        ),
      ),
    );
    room.broadcast(
      msg("participant_joined", { participant: session.participant }),
      c.userId,
    );
    this.chat(
      room,
      "system",
      "Canvas",
      `${session.participant.username} joined`,
      crypto.randomUUID(),
      true,
    );
    room.dirty = true;
  }
  private joinPayload(
    room: Room,
    s: Session,
    lastSeq?: number,
    ownerKey?: string,
  ) {
    const delta =
      lastSeq !== undefined &&
      lastSeq >= 0 &&
      lastSeq <= room.state.seq &&
      (lastSeq === room.state.seq || room.ops[0]?.seq <= lastSeq + 1);
    return {
      code: room.code,
      you: s.participant,
      participants: room.roster(),
      settings: room.settings,
      seq: room.state.seq,
      mode: delta ? ("delta" as const) : ("snapshot" as const),
      ...(delta
        ? { ops: room.ops.filter((o) => o.seq > lastSeq!) }
        : { snapshot: room.state }),
      chat: room.chat,
      present: room.present,
      resumeToken: s.token,
      ownerKey,
    };
  }
  private leave(c: Connection, graceful: boolean) {
    if (!c.room) return;
    const room = this.rooms.get(c.room);
    const session = room?.sessions.get(c.userId);
    if (room && session && session.connection === c) {
      session.connection = undefined;
      if (graceful) {
        room.sessions.delete(c.userId);
        room.broadcast(
          msg("participant_left", { participant: session.participant }),
        );
        this.chat(
          room,
          "system",
          "Canvas",
          `${session.participant.username} left`,
          crypto.randomUUID(),
          true,
        );
      } else {
        session.expires = Date.now() + this.config.graceMs;
        session.participant.status = "reconnecting";
        room.broadcast(
          msg("participant_updated", { participant: session.participant }),
        );
      }
      room.dirty = true;
    }
    c.room = "";
    c.userId = "";
    if (c.state !== "closed") c.state = "lobby";
  }
  private disconnected(c: Connection) {
    this.connections.delete(c);
    this.leave(c, false);
    const p = this.pending.get(c.id);
    if (p) {
      clearTimeout(p.timer);
      this.pending.delete(c.id);
    }
    for (const key of this.buckets.keys())
      if (key.startsWith(c.id + ":")) this.buckets.delete(key);
  }
  private commit(
    c: Connection,
    room: Room,
    opId: string,
    op: Op,
    restoring = false,
  ) {
    const prior = room.dedup.get(opId);
    if (prior) {
      c.send(msg("op_applied", prior));
      return;
    }
    this.require(c, "draw");
    this.rate(c.id + ":op");
    op = opSchema.parse(op);
    let destructive = false;
    const check = (value: Op, depth = 0) => {
      if (depth > 8)
        throw new ProtocolError("INVALID_OP", "Batch nesting too deep");
      if (value.kind === "batch") value.ops.forEach((o) => check(o, depth + 1));
      if (value.kind === "clear") {
        this.require(c, "clear");
        destructive = true;
      }
      if (value.kind === "patch" && value.set.text !== undefined) {
        const lock = room.locks.get(value.id);
        if (lock && lock.until > Date.now() && lock.by !== c.userId)
          throw new ProtocolError(
            "DENIED",
            "Someone else is editing this element",
          );
      }
      if (value.kind === "replace_state" && !restoring)
        this.require(c, "import");
      if (value.kind === "replace_state") destructive = true;
    };
    check(op);
    const s = room.sessions.get(c.userId)!;
    const ts = Date.now();
    const result = applyOp(room.state, op, {
      by: c.userId,
      byName: s.participant.username,
      ts,
    });
    // A full import's log entry shares immutable element records with the accepted state.
    // Keeping two separately parsed 5000-element copies per room exceeds the memory budget.
    if (op.kind === "replace_state")
      op = { kind: "replace_state", state: { ...result.state } };
    if (destructive)
      this.snapshot(
        room,
        "Before " + (op.kind === "clear" ? "clear" : "restore"),
        c.userId,
        true,
      );
    const applied: Applied = {
      seq: room.state.seq + 1,
      opId,
      by: c.userId,
      byName: s.participant.username,
      ts,
      op,
    };
    result.state.seq = applied.seq;
    this.persistence.append(room.code, applied);
    room.state = result.state;
    room.ops.push(applied);
    if (room.ops.length > 5000) room.ops.shift();
    room.dedup.set(opId, applied);
    if (room.dedup.size > 10000)
      room.dedup.delete(room.dedup.keys().next().value!);
    room.dirty = true;
    this.opCount++;
    room.broadcast(msg("op_applied", applied));
    if (applied.seq % 200 === 0) this.checkpoint(room);
  }
  private sync(c: Connection, room: Room, fromSeq: number) {
    if (
      fromSeq >= 0 &&
      fromSeq <= room.state.seq &&
      (fromSeq === room.state.seq || room.ops[0]?.seq <= fromSeq + 1)
    )
      c.send(
        msg("sync_delta", {
          fromSeq,
          toSeq: room.state.seq,
          ops: room.ops.filter((o) => o.seq > fromSeq),
        }),
      );
    else
      c.send(
        msg("sync_snapshot", { seq: room.state.seq, snapshot: room.state }),
      );
  }
  private checkpoint(room: Room) {
    room.broadcast(
      msg("checkpoint", {
        seq: room.state.seq,
        hash: stateHash(room.state),
        count: Object.keys(room.state.elements).length,
      }),
    );
  }
  private chat(
    room: Room,
    by: string,
    username: string,
    text: string,
    id: string,
    system = false,
  ) {
    const entry = { id, by, username, text, ts: Date.now(), system };
    room.chat.push(entry);
    if (room.chat.length > 500) room.chat.shift();
    room.broadcast(msg("chat_msg", entry));
    room.dirty = true;
  }
  private snapshot(
    room: Room,
    label: string,
    by: string,
    auto: boolean,
    thumb?: string,
  ) {
    const snap: Snapshot = {
      id: crypto.randomUUID(),
      label,
      by,
      ts: Date.now(),
      elementCount: Object.keys(room.state.elements).length,
      thumb,
      auto,
    };
    room.snapshots.push(snap);
    this.persistence.save(
      room.code,
      "snapshots/" + snap.id + ".json",
      room.state,
    );
    if (room.snapshots.length > 50) {
      const old = room.snapshots.shift()!;
      this.persistence.remove(room.code, "snapshots/" + old.id + ".json");
    }
    room.lastSavedSeq = room.state.seq;
    room.dirty = true;
    room.broadcast(msg("snap_changed", {}));
  }
  private snapshotState(room: Room, snapshot: Snapshot) {
    const state =
      snapshot.state ||
      this.persistence.read<unknown>(
        room.code,
        "snapshots/" + snapshot.id + ".json",
        null,
      );
    if (!state)
      throw new ProtocolError("NOT_FOUND", "Version data is unavailable");
    return boardSchema.parse(state);
  }
  private assetPath(room: Room, hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash))
      throw new ProtocolError("BAD_MSG", "Invalid asset hash");
    const dir = join(this.persistence.dir(room.code), "assets");
    mkdirSync(dir, { recursive: true });
    return join(dir, hash);
  }
  private upload(c: Connection, room: Room, p: any) {
    this.require(c, "draw");
    const key = c.id + ":" + p.hash;
    const part = Buffer.from(p.data, "base64");
    if (part.length > LIMITS.assetChunk)
      throw new ProtocolError("TOO_LARGE", "Asset chunk exceeds limit");
    let upload = this.uploads.get(key);
    if (!upload) {
      if (this.uploads.size > 30)
        throw new ProtocolError("RATE_LIMITED", "Too many uploads");
      upload = {
        parts: [],
        size: p.size,
        mime: p.mime,
        total: p.total,
        until: Date.now() + 30000,
      };
      this.uploads.set(key, upload);
    }
    if (p.idx !== upload.parts.length || p.total !== upload.total)
      throw new ProtocolError("BAD_MSG", "Asset chunks must be ordered");
    upload.parts.push(part);
    if (upload.parts.length === p.total) {
      this.uploads.delete(key);
      const buffer = Buffer.concat(upload.parts);
      if (
        buffer.length !== p.size ||
        createHash("sha256").update(buffer).digest("hex") !== p.hash
      )
        throw new ProtocolError("BAD_MSG", "Asset integrity check failed");
      const mime = this.mime(buffer);
      if (mime !== p.mime)
        throw new ProtocolError("BAD_MSG", "Asset file type mismatch");
      const path = this.assetPath(room, p.hash);
      const used = readdirSync(join(this.persistence.dir(room.code), "assets"))
        .filter((n) => /^[a-f0-9]{64}$/.test(n))
        .reduce(
          (n, f) =>
            n +
            statSync(join(this.persistence.dir(room.code), "assets", f)).size,
          0,
        );
      if (used + buffer.length > 200 * 1024 * 1024)
        throw new ProtocolError("TOO_LARGE", "Room asset storage is full");
      writeFileSync(path, buffer);
      c.send(msg("asset_put_ok", { hash: p.hash }));
    }
  }
  private mime(b: Buffer) {
    if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      return "image/png";
    if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
    if (b.subarray(0, 3).toString() === "GIF") return "image/gif";
    if (
      b.subarray(0, 4).toString() === "RIFF" &&
      b.subarray(8, 12).toString() === "WEBP"
    )
      return "image/webp";
    throw new ProtocolError("BAD_MSG", "Unsupported image bytes");
  }
  private download(c: Connection, room: Room, hash: string) {
    const path = this.assetPath(room, hash);
    if (!existsSync(path))
      throw new ProtocolError("NOT_FOUND", "Image unavailable");
    const buffer = readFileSync(path),
      total = Math.ceil(buffer.length / LIMITS.assetChunk),
      mime = this.mime(buffer);
    for (let idx = 0; idx < total; idx++)
      c.send(
        msg("asset_chunk", {
          hash,
          mime,
          idx,
          total,
          data: buffer
            .subarray(idx * LIMITS.assetChunk, (idx + 1) * LIMITS.assetChunk)
            .toString("base64"),
        }),
      );
  }
  private persist(room: Room) {
    this.persistence.save(room.code, "state.json", room.state);
    this.persistence.save(room.code, "meta.json", {
      settings: room.settings,
      ownerKey: room.ownerKey,
      password: room.password,
      bans: room.bans,
      lastActive: room.lastActive,
      chat: room.chat,
      sessions: [...room.sessions.values()].map(
        ({ connection: _connection, ...s }) => ({
          ...s,
          expires: Date.now() + this.config.graceMs,
        }),
      ),
    });
    this.persistence.save(room.code, "snapshots/index.json", room.snapshots);
    // Durable dedup history is longer than the exposed delta window, so a restart cannot reapply old retries.
    this.persistence.compact(room.code, [...room.dedup.values()]);
    room.dirty = false;
  }
  private recover() {
    for (const code of this.persistence.codes()) {
      try {
        const meta = this.persistence.read<any>(code, "meta.json", null);
        if (
          !meta ||
          this.persistence.read(code, "closed.json", false) ||
          Date.now() - meta.lastActive > 7 * 86400000
        )
          continue;
        const room = new Room(code, meta.settings.name);
        Object.assign(room, {
          settings: meta.settings,
          ownerKey: meta.ownerKey,
          password: meta.password,
          bans: meta.bans || [],
          lastActive: meta.lastActive,
          chat: meta.chat || [],
        });
        room.state = boardSchema.parse(
          this.persistence.read(code, "state.json", room.state),
        );
        const journal = this.persistence.log(code).slice(-10000);
        room.ops = journal.slice(-5000);
        for (const op of journal) {
          if (op.seq > room.state.seq) {
            room.state = applyOp(room.state, op.op, {
              by: op.by,
              byName: op.byName,
              ts: op.ts,
            }).state;
            room.state.seq = op.seq;
          }
          room.dedup.set(op.opId, op);
        }
        for (const s of meta.sessions || [])
          if (s.expires > Date.now()) {
            s.participant.status = "reconnecting";
            room.sessions.set(s.participant.id, s);
          }
        room.snapshots = this.persistence.read(
          code,
          "snapshots/index.json",
          this.persistence.read(code, "snapshots.json", []),
        );
        room.chatIds = new Set(room.chat.map((m) => m.id));
        this.rooms.set(code, room);
      } catch (error) {
        console.warn("Room recovery failed", code, error);
      }
    }
  }
  private tick() {
    const now = Date.now();
    for (const c of this.connections)
      if (now - c.lastSeen > this.config.timeoutMs)
        c.close("Heartbeat timeout");
    for (const room of this.rooms.values()) {
      for (const [id, s] of room.sessions)
        if (s.expires && s.expires < now) {
          room.sessions.delete(id);
          room.broadcast(
            msg("participant_left", { participant: s.participant }),
          );
          if (room.present.presenterId === id) {
            room.present = { active: false };
            room.broadcast(msg("present_state", room.present));
          }
        }
      for (const [id, lock] of room.locks)
        if (lock.until < now) room.locks.delete(id);
      if (room.dirty && Math.floor(now / 1000) % 2 === 0) this.persist(room);
      if (Math.floor(now / 1000) % 30 === 0) this.checkpoint(room);
      if (
        Math.floor(now / 1000) % 300 === 0 &&
        room.lastSavedSeq !== room.state.seq
      )
        this.snapshot(room, "Autosave", "system", true);
      if (!room.sessions.size && now - room.lastActive > 7 * 86400000)
        this.rooms.delete(room.code);
    }
    for (const [key, u] of this.uploads)
      if (u.until < now) this.uploads.delete(key);
    for (const [key, v] of this.failures)
      if (v.until < now) this.failures.delete(key);
  }
  /** Console commands share the same authority state as network handlers. */
  command(line: string) {
    const [command, code, id] = line.trim().split(/\s+/);
    if (command === "stats") {
      const now = Date.now(),
        opsPerSecond =
          (this.opCount - this.statsOps) /
          Math.max(0.001, (now - this.statsAt) / 1000);
      this.statsAt = now;
      this.statsOps = this.opCount;
      return JSON.stringify({
        clients: this.connections.size,
        rooms: this.rooms.size,
        ops: this.opCount,
        opsPerSecond: Math.round(opsPerSecond * 100) / 100,
        rssMB: Math.round(process.memoryUsage().rss / 1048576),
      });
    }
    if (command === "rooms")
      return [...this.rooms.values()]
        .map(
          (r) =>
            `${r.code} ${r.settings.name} ${r.sessions.size} users seq ${r.state.seq}`,
        )
        .join("\n");
    if (command === "clients")
      return [...this.connections]
        .map((c) => `${c.id} ${c.ip} ${c.room}`)
        .join("\n");
    if (command === "close") {
      const room = this.rooms.get(code);
      if (room) {
        for (const s of room.sessions.values())
          s.connection?.close("Room closed");
        this.persist(room);
        this.persistence.save(code, "closed.json", true);
        this.rooms.delete(code);
      }
      return "Room closed";
    }
    if (command === "kick") {
      const room = this.rooms.get(code),
        session = room?.sessions.get(id),
        connection = session?.connection;
      if (connection) {
        this.leave(connection, true);
        connection.close("Kicked by server");
      } else room?.sessions.delete(id);
      return "Participant disconnected";
    }
    return "Commands: rooms, clients, kick <code> <user>, close <code>, stats, quit";
  }
}
