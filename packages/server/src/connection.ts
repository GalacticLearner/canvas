/** TCP connection owns framing, bounded output, timestamps and handshake lifecycle. */
import type { Socket } from "node:net";
import {
  FrameDecoder,
  encodeFrame,
  encodeFrames,
  parseEnvelope,
  msg,
  LIMITS,
  ProtocolError,
  type Envelope,
} from "../../shared/src/index";
/** A socket is never exposed to board logic, preventing competing writers. */
export class Connection {
  id = crypto.randomUUID();
  clientId = "";
  identityColorHint = "";
  room = "";
  userId = "";
  lastSeen = Date.now();
  state: "new" | "lobby" | "joined" | "closed" = "new";
  decoder = new FrameDecoder();
  ip: string;
  helloTimer: ReturnType<typeof setTimeout>;
  joinTimer?: ReturnType<typeof setTimeout>;
  lastEphemeral = new Map<string, number>();
  private queue: { frame: Buffer; ephemeral: boolean }[] = [];
  private queueBytes = 0;
  private blocked = false;
  constructor(
    public socket: Socket,
    onMessage: (c: Connection, e: Envelope) => void,
    onClose: (c: Connection) => void,
  ) {
    this.ip = socket.remoteAddress || "unknown";
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 5000);
    this.helloTimer = setTimeout(() => this.close("Handshake timeout"), 5000);
    socket.on("data", (chunk) => {
      this.lastSeen = Date.now();
      let frames: unknown[];
      try {
        frames = this.decoder.push(chunk);
      } catch {
        this.send(
          msg("error", {
            code: "BAD_FRAME",
            message: "Malformed or unsupported protocol frame",
          }),
        );
        this.close("Protocol error");
        return;
      }
      for (const raw of frames) {
        try {
          onMessage(this, parseEnvelope(raw));
        } catch (error) {
          const envelope = raw as any;
          if (envelope?.t === "op" && typeof envelope.p?.opId === "string") {
            this.send(
              msg("op_rejected", {
                opId: envelope.p.opId.slice(0, 100),
                code: "INVALID_OP",
                message: "Operation does not match the board schema",
              }),
            );
            continue;
          }
          const code = error instanceof ProtocolError ? error.code : "BAD_MSG";
          this.send(
            msg("error", {
              code,
              message:
                error instanceof ProtocolError
                  ? error.message
                  : "Message does not match the protocol schema",
            }),
          );
          this.close("Invalid message");
        }
      }
    });
    socket.on("error", () => {});
    socket.on("drain", () => {
      this.blocked = false;
      this.flush();
    });
    socket.on("close", () => {
      clearTimeout(this.helloTimer);
      clearTimeout(this.joinTimer);
      this.state = "closed";
      onClose(this);
    });
  }
  /** Ephemeral traffic is expendable; persistent updates instead force a resync on overload. */
  send(envelope: Envelope) {
    if (this.socket.destroyed) return;
    const queued = this.socket.writableLength + this.queueBytes;
    if (queued > LIMITS.hardQueue) {
      this.close("Slow client; reconnect to resync");
      return;
    }
    if (queued > LIMITS.softQueue && envelope.t === "eph") return;
    if (queued > LIMITS.softQueue) {
      this.queue = this.queue.filter((item) => {
        if (item.ephemeral) {
          this.queueBytes -= item.frame.length;
          return false;
        }
        return true;
      });
    }
    try {
      for (const frame of encodeFrames({
        ...envelope,
        ts: envelope.ts ?? Date.now(),
      })) {
        this.queue.push({ frame, ephemeral: envelope.t === "eph" });
        this.queueBytes += frame.length;
      }
      this.flush();
    } catch {
      this.close("Message exceeds frame limit");
    }
  }
  private flush() {
    while (!this.blocked && this.queue.length && !this.socket.destroyed) {
      const next = this.queue.shift()!;
      this.queueBytes -= next.frame.length;
      this.blocked = !this.socket.write(next.frame);
    }
  }
  /** Closing has a short flush deadline, so half-open peers cannot retain resources. */
  close(reason: string) {
    if (this.socket.destroyed || this.socket.writableEnded) return;
    this.socket.end(encodeFrame(msg("bye", { reason }, { ts: Date.now() })));
    const timer = setTimeout(() => this.socket.destroy(), 100);
    timer.unref();
  }
}
