/** Raw TCP fault proxy deliberately fragments, delays, duplicates or drops complete frames. */
import { createServer, createConnection, type Socket } from "node:net";
import { FrameDecoder, encodeFrame } from "../../packages/shared/src/index";
/** Fault knobs are deterministic under the caller-supplied random function. */
export interface ChaosOptions {
  port: number;
  targetPort: number;
  host?: string;
  latency?: number;
  jitter?: number;
  fragment?: number;
  duplicate?: number;
  drop?: number;
  blackhole?: boolean;
  resetAfterMs?: number;
  random?: () => number;
}
/** Start a bidirectional proxy and return a close method that owns all live sockets/timers. */
export async function chaosProxy(options: ChaosOptions) {
  const sockets = new Set<Socket>(),
    timers = new Set<ReturnType<typeof setTimeout>>();
  const random = options.random || Math.random;
  const server = createServer((client) => {
    const upstream = createConnection({
      port: options.targetPort,
      host: options.host || "127.0.0.1",
    });
    sockets.add(client);
    sockets.add(upstream);
    for (const [from, to] of [
      [client, upstream],
      [upstream, client],
    ]) {
      const decoder = new FrameDecoder();
      let due = Date.now();
      from.on("error", () => to.destroy());
      from.on("close", () => {
        sockets.delete(from);
        to.destroy();
      });
      from.on("data", (data) => {
        if (options.blackhole) return;
        try {
          for (const message of decoder.push(data)) {
            if (random() < (options.drop || 0)) continue;
            const frame = encodeFrame(message),
              copies = random() < (options.duplicate || 0) ? 2 : 1;
            for (let copy = 0; copy < copies; copy++) {
              due = Math.max(
                due,
                Date.now() +
                  (options.latency || 0) +
                  random() * (options.jitter || 0),
              );
              const timer = setTimeout(
                () => {
                  timers.delete(timer);
                  if (!to.destroyed) {
                    for (
                      let offset = 0;
                      offset < frame.length;
                      offset += options.fragment || frame.length
                    )
                      to.write(
                        frame.subarray(
                          offset,
                          offset + (options.fragment || frame.length),
                        ),
                      );
                  }
                },
                Math.max(0, due - Date.now()),
              );
              timers.add(timer);
            }
          }
        } catch {
          from.destroy();
        }
      });
    }
    if (options.resetAfterMs) {
      const timer = setTimeout(() => client.destroy(), options.resetAfterMs);
      timers.add(timer);
    }
  });
  await new Promise<void>((resolve) =>
    server.listen(options.port, "127.0.0.1", resolve),
  );
  return {
    port: (server.address() as { port: number }).port,
    close: async () => {
      for (const timer of timers) clearTimeout(timer);
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
