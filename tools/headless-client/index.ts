/** Test/demo client speaks the identical raw TCP framing as Electron's main process. */
import { createConnection, type Socket } from "node:net";
import { scryptSync, createHmac } from "node:crypto";
import {
  FrameDecoder,
  encodeFrames,
  msg,
  type Envelope,
} from "../../packages/shared/src/index";
/** Message mailbox supports awaiting replies without racing socket callbacks. */
export class HeadlessClient {
  socket!: Socket;
  messages: Envelope[] = [];
  private waiters: {
    type: string;
    resolve: (e: Envelope) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }[] = [];
  onMessage?: (e: Envelope) => void;
  /** Connect and complete the hello exchange. */
  async connect(port: number, host = "127.0.0.1") {
    this.socket = createConnection({ host, port });
    this.socket.setNoDelay(true);
    this.socket.on("error", () => {});
    const decoder = new FrameDecoder();
    this.socket.on("data", (data) => {
      for (const message of decoder.push(data) as Envelope[]) {
        this.onMessage?.(message);
        const i = this.waiters.findIndex((w) => w.type === message.t);
        if (i >= 0) {
          const [waiter] = this.waiters.splice(i, 1);
          clearTimeout(waiter.timer);
          waiter.resolve(message);
        } else if (
          !this.onMessage ||
          !["op_applied", "eph", "pong"].includes(message.t)
        ) {
          this.messages.push(message);
          if (this.messages.length > 1000) this.messages.shift();
        }
      }
    });
    await new Promise<void>((resolve, reject) => {
      this.socket.once("connect", resolve);
      this.socket.once("error", reject);
    });
    this.send(
      msg("hello", {
        clientId: crypto.randomUUID(),
        app: "headless",
        appVersion: "0.1",
        platform: process.platform,
      }),
    );
    await this.wait("hello_ack");
    return this;
  }
  /** Send a typed envelope. */
  send(e: Envelope) {
    for (const frame of encodeFrames(e)) this.socket.write(frame);
  }
  /** Await a message type, consuming any already-received response first. */
  wait(type: string, timeout = 5000): Promise<Envelope> {
    const idx = this.messages.findIndex((e) => e.t === type);
    if (idx >= 0) return Promise.resolve(this.messages.splice(idx, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer);
        reject(new Error("Timed out waiting for " + type));
      }, timeout);
      this.waiters.push({ type, resolve, reject, timer });
    });
  }
  /** Test password challenge; the password is never placed in room_join. */
  async prove(password: string) {
    const e = await this.wait("auth_challenge");
    const key = scryptSync(password, e.p.salt, 32, e.p.kdf);
    this.send(
      msg("auth_proof", {
        proof: createHmac("sha256", key).update(e.p.nonce).digest("hex"),
      }),
    );
  }
  /** Tear down pending waits and the TCP socket. */
  close() {
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.reject(new Error("Client closed"));
    }
    this.waiters = [];
    this.socket?.destroy();
  }
}
