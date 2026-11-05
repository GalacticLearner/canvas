/** Length-prefixed UTF-8 JSON framing for TCP's arbitrary chunk boundaries. */
import { LIMITS, ProtocolError } from "./constants";
/** Encode one JSON value, refusing empty or oversized payloads before allocation. */
export function encodeFrame(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  if (!payload.length || payload.length > LIMITS.maxFrame)
    throw new ProtocolError("BAD_FRAME", "Frame size exceeds limits");
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32BE(payload.length);
  payload.copy(frame, 4);
  return frame;
}
/** Split large snapshots/imports into bounded transport frames without changing their logical envelope. */
export function encodeFrames(value: unknown): Buffer[] {
  const data = Buffer.from(JSON.stringify(value), "utf8");
  if (data.length <= LIMITS.maxFrame) return [encodeFrame(value)];
  if (data.length > 64 * 1024 * 1024)
    throw new ProtocolError("TOO_LARGE", "Logical message exceeds 64 MiB");
  const size = 1024 * 1024,
    total = Math.ceil(data.length / size),
    transferId = crypto.randomUUID();
  return Array.from({ length: total }, (_, idx) =>
    encodeFrame({
      v: 1,
      t: "transfer_chunk",
      p: {
        transferId,
        idx,
        total,
        data: data.subarray(idx * size, (idx + 1) * size).toString("base64"),
      },
    }),
  );
}
/** Streaming decoder bounds buffered bytes and rejects malformed UTF-8, not replacement text. */
export class FrameDecoder {
  private buffer = Buffer.alloc(0);
  private transfer?: {
    id: string;
    total: number;
    parts: Buffer[];
    bytes: number;
    started: number;
  };
  /** Drain complete frames while retaining only the incomplete tail. */
  push(chunk: Uint8Array): unknown[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const values: unknown[] = [];
    while (this.buffer.length >= 4) {
      const n = this.buffer.readUInt32BE();
      if (!n || n > LIMITS.maxFrame) {
        this.buffer = Buffer.alloc(0);
        throw new ProtocolError("BAD_FRAME", "Invalid frame length");
      }
      if (this.buffer.length < n + 4) break;
      try {
        const value = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            this.buffer.subarray(4, n + 4),
          ),
        );
        if (value?.t === "transfer_chunk") {
          const p = value.p;
          if (
            !p ||
            typeof p.transferId !== "string" ||
            !Number.isInteger(p.idx) ||
            !Number.isInteger(p.total) ||
            p.total < 1 ||
            p.total > 64 ||
            typeof p.data !== "string" ||
            p.data.length > 1400000
          )
            throw new Error("Invalid transfer");
          if (p.idx === 0) {
            if (this.transfer) throw new Error("Overlapping transfer");
            this.transfer = {
              id: p.transferId,
              total: p.total,
              parts: [],
              bytes: 0,
              started: Date.now(),
            };
          }
          const transfer = this.transfer;
          if (
            !transfer ||
            transfer.id !== p.transferId ||
            p.idx !== transfer.parts.length ||
            p.total !== transfer.total ||
            Date.now() - transfer.started > 30000
          )
            throw new Error("Out-of-order or expired transfer");
          const part = Buffer.from(p.data, "base64");
          transfer.parts.push(part);
          transfer.bytes += part.length;
          if (transfer.bytes > 64 * 1024 * 1024)
            throw new Error("Transfer exceeds limit");
          if (transfer.parts.length === transfer.total) {
            const parsed = JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(
                Buffer.concat(transfer.parts),
              ),
            );
            if (parsed?.t === "transfer_chunk")
              throw new Error("Nested transfer");
            values.push(parsed);
            this.transfer = undefined;
          }
        } else values.push(value);
      } catch {
        this.buffer = Buffer.alloc(0);
        throw new ProtocolError("BAD_FRAME", "Invalid UTF-8 or JSON");
      }
      this.buffer =
        n + 4 === this.buffer.length
          ? Buffer.alloc(0)
          : this.buffer.subarray(n + 4);
    }
    return values;
  }
}
