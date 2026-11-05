/** Electron main owns raw TCP, password proofs, heartbeat and automatic session recovery. */
import { EventEmitter } from "node:events";
import { createConnection, type Socket } from "node:net";
import { scryptSync, createHmac } from "node:crypto";
import { isIP } from "node:net";
import { readStore, writeStore } from "./storage";
import {
  FrameDecoder,
  encodeFrames,
  msg,
  parseEnvelope,
  type Envelope,
} from "../../shared/src/index";
/** Restrict application traffic to loopback/private/link-local addresses. */
export function isLanAddress(host: string) {
  if (host === "localhost" || host === "::1") return true;
  if (!isIP(host)) return false;
  return (
    /^127\.|^10\.|^192\.168\.|^169\.254\./.test(host) ||
    (/^172\./.test(host) &&
      Number(host.split(".")[1]) >= 16 &&
      Number(host.split(".")[1]) <= 31) ||
    /^f[cd]|^fe80:/i.test(host)
  );
}
/** Finite connection states are visible in the UI and diagnostic logs. */
export type NetStatus =
  | "idle"
  | "connecting"
  | "handshaking"
  | "joining"
  | "live"
  | "reconnecting"
  | "closed"
  | "kicked";
/** Session reconnection reuses a token while preserving op ids in the renderer queue. */
export class NetClient extends EventEmitter {
  private socket?: Socket;
  private timer?: ReturnType<typeof setInterval>;
  private retry?: ReturnType<typeof setTimeout>;
  private lastFrame = 0;
  private attempt = 0;
  private stopped = false;
  private options: any;
  private resume?: { code: string; token: string; username: string };
  private password = "";
  private lastSeq = 0;
  status: NetStatus = "idle";
  readonly clientId: string;
  constructor(clientId: string) {
    super();
    this.clientId = clientId;
  }
  /** Accept only a private numeric address (or localhost), preventing DNS rebinding/external traffic. */
  connect(options: any) {
    this.disconnect();
    if (
      !options ||
      typeof options.host !== "string" ||
      !isLanAddress(options.host) ||
      !Number.isInteger(options.port) ||
      options.port < 1 ||
      options.port > 65535
    )
      throw new Error(
        "Use a private LAN IP address and port, for example 192.168.1.10:5050",
      );
    this.options = options;
    this.password = options.password || "";
    const key = `session-${options.host.replace(/[^a-z0-9]/gi, "_")}-${options.port}-${options.code || "new"}`;
    const saved = options.mode === "join" ? (readStore(key) as any) : null;
    this.resume = saved?.resume;
    this.lastSeq = 0;
    if (saved?.ownerKey) this.options.ownerKey = saved.ownerKey;
    this.stopped = false;
    this.attempt = 0;
    this.open();
  }
  private setStatus(status: NetStatus, detail = "") {
    this.status = status;
    console.log(`[Canvas network] ${status}${detail ? ":" + detail : ""}`);
    this.emit("status", { status, detail });
  }
  private open() {
    if (this.stopped) return;
    this.setStatus(this.attempt ? "reconnecting" : "connecting");
    const decoder = new FrameDecoder();
    const socket = createConnection({
      host: this.options.host,
      port: this.options.port,
    });
    this.socket = socket;
    this.socket.setNoDelay(true);
    this.socket.setKeepAlive(true, 5000);
    this.lastFrame = Date.now();
    this.socket.setTimeout(15000, () => socket.destroy());
    this.socket.on("connect", () => {
      if (this.socket !== socket) return;
      this.setStatus("handshaking");
      this.send(
        msg("hello", {
          clientId: this.clientId,
          app: "Canvas",
          appVersion: "0.1.0",
          platform: process.platform,
          identityColorHint: this.options.identityColorHint || undefined,
        }),
      );
    });
    this.socket.on("data", (data) => {
      if (this.socket !== socket) return;
      this.lastFrame = Date.now();
      try {
        for (const raw of decoder.push(data)) {
          const e = parseEnvelope(raw);
          if (e.t === "hello_ack") {
            this.setStatus("joining");
            if (this.resume)
              this.send(
                msg("room_join", {
                  code: this.resume.code,
                  username: this.resume.username,
                  resumeToken: this.resume.token,
                  lastSeq: this.lastSeq,
                  ownerKey: this.options.ownerKey,
                }),
              );
            else if (this.options.mode === "create")
              this.send(
                msg("room_create", {
                  name: this.options.name || "Workshop",
                  username: this.options.username,
                  password: this.password,
                  settings: this.options.settings,
                }),
              );
            else
              this.send(
                msg("room_join", {
                  code: this.options.code,
                  username: this.options.username,
                  ownerKey: this.options.ownerKey,
                }),
              );
          }
          if (e.t === "auth_challenge") {
            const key = scryptSync(this.password, e.p.salt, 32, e.p.kdf);
            this.send(
              msg("auth_proof", {
                proof: createHmac("sha256", key)
                  .update(e.p.nonce)
                  .digest("hex"),
              }),
            );
          }
          if (e.t === "join_ok") {
            this.resume = {
              code: e.p.code,
              token: e.p.resumeToken,
              username: e.p.you.username,
            };
            if (e.p.ownerKey) this.options.ownerKey = e.p.ownerKey;
            writeStore(
              `session-${this.options.host.replace(/[^a-z0-9]/gi, "_")}-${this.options.port}-${e.p.code}`,
              { resume: this.resume, ownerKey: this.options.ownerKey },
            );
            this.attempt = 0;
            this.setStatus("live");
          }
          if (e.t === "bye") {
            this.stopped = true;
            this.setStatus(
              /kick|ban/i.test(e.p.reason) ? "kicked" : "closed",
              e.p.reason,
            );
          }
          if (e.t === "join_denied") {
            this.stopped = true;
            this.setStatus("closed", e.p.message);
            this.socket?.end();
          }
          if (e.t === "ping") this.send(msg("pong", e.p));
          if (e.t === "pong") this.emit("rtt", Date.now() - e.p.n);
          this.emit("message", e);
        }
      } catch {
        this.socket?.destroy();
      }
    });
    this.socket.on("error", () => {
      if (this.socket !== socket) return;
      this.setStatus(
        "reconnecting",
        "Cannot reach server. Check the LAN address, TCP port and Windows Firewall.",
      );
    });
    this.socket.on("close", () => {
      if (this.socket !== socket) return;
      clearInterval(this.timer);
      if (!this.stopped) {
        this.setStatus("reconnecting");
        this.retry = setTimeout(
          () => this.open(),
          Math.min(8000, 500 * 2 ** this.attempt++) + Math.random() * 200,
        );
      }
    });
    this.timer = setInterval(() => {
      if (Date.now() - this.lastFrame > 15000) this.socket?.destroy();
      else this.send(msg("ping", { n: Date.now() }));
    }, 5000);
  }
  /** Only validated envelopes leave the main process. */
  send(e: Envelope) {
    const parsed = parseEnvelope(e);
    if (this.socket && !this.socket.destroyed)
      for (const frame of encodeFrames(parsed)) this.socket.write(frame);
  }
  /** Renderer confirms its applied sequence, not merely the last received socket frame. */
  acknowledge(seq: number) {
    if (Number.isInteger(seq) && seq >= 0) this.lastSeq = seq;
  }
  /** Explicit leave suppresses reconnect and clears all timers. */
  disconnect() {
    this.stopped = true;
    clearInterval(this.timer);
    clearTimeout(this.retry);
    this.socket?.destroy();
    this.setStatus("idle");
  }
}
