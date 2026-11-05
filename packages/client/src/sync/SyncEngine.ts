/** Optimistic replica separates authority state from replayable local intent. */
import {
  applyOp,
  emptyBoard,
  msg,
  stateHash,
  type BoardState,
  type Op,
  type Envelope,
} from "../../../shared/src/index";
/** Persisted pending operation retains the same id on every reconnect retry. */
export interface PendingOp {
  opId: string;
  op: Op;
  ts: number;
}
/** Recovery engine is renderer-independent so real TCP tests can exercise all paths. */
export class SyncEngine {
  confirmed: BoardState = emptyBoard();
  pending: PendingOp[] = [];
  view: BoardState = emptyBoard();
  private buffered = new Map<number, any>();
  onChange = () => {};
  onReject = (_message: string) => {};
  by = "local";
  byName = "You";
  constructor(private send: (e: Envelope) => void) {}
  /** Queue a gesture only after it can apply locally. */
  submit(op: Op) {
    const entry = { opId: crypto.randomUUID(), op, ts: Date.now() };
    applyOp(this.view, op, { by: this.by, byName: this.byName, ts: entry.ts });
    this.pending.push(entry);
    this.replay();
    this.send(msg("op", { opId: entry.opId, op: entry.op }));
    return entry.opId;
  }
  /** Install a complete authority checkpoint while retaining unsent local intent. */
  snapshot(state: BoardState) {
    this.confirmed = structuredClone(state);
    for (const seq of this.buffered.keys())
      if (seq <= state.seq) this.buffered.delete(seq);
    this.replay();
    this.drain();
  }
  /** Retry exactly the original ids, allowing server-side deduplication. */
  resend() {
    for (const entry of this.pending)
      this.send(msg("op", { opId: entry.opId, op: entry.op }));
  }
  /** Wire message dispatch enforces gap-free application and automatic hash recovery. */
  receive(e: Envelope) {
    if (e.t === "op_applied") this.accept(e.p);
    if (e.t === "sync_delta") {
      for (const op of e.p.ops) this.accept(op);
    }
    if (e.t === "sync_snapshot") this.snapshot(e.p.snapshot);
    if (e.t === "join_ok") {
      this.by = e.p.you.id;
      this.byName = e.p.you.username;
      if (e.p.mode === "snapshot") this.snapshot(e.p.snapshot);
      else for (const op of e.p.ops || []) this.accept(op);
      this.resend();
    }
    if (e.t === "op_rejected") {
      this.pending = this.pending.filter((p) => p.opId !== e.p.opId);
      this.replay();
      this.onReject(e.p.message);
    }
    if (
      e.t === "checkpoint" &&
      e.p.seq === this.confirmed.seq &&
      e.p.hash !== stateHash(this.confirmed)
    )
      this.send(msg("sync_req", { fromSeq: -1 }));
  }
  private accept(entry: any) {
    if (entry.seq <= this.confirmed.seq) {
      this.pending = this.pending.filter((p) => p.opId !== entry.opId);
      this.replay();
      return;
    }
    if (entry.seq !== this.confirmed.seq + 1) {
      this.buffered.set(entry.seq, entry);
      this.send(msg("sync_req", { fromSeq: this.confirmed.seq }));
      return;
    }
    try {
      this.confirmed = applyOp(this.confirmed, entry.op, {
        by: entry.by,
        byName: entry.byName || entry.by,
        ts: entry.ts || 0,
      }).state;
      this.confirmed.seq = entry.seq;
      this.pending = this.pending.filter((p) => p.opId !== entry.opId);
      this.replay();
      this.drain();
    } catch {
      this.send(msg("sync_req", { fromSeq: -1 }));
    }
  }
  private drain() {
    const next = this.buffered.get(this.confirmed.seq + 1);
    if (next) {
      this.buffered.delete(next.seq);
      this.accept(next);
    }
  }
  private replay() {
    let state = this.confirmed;
    for (const entry of this.pending) {
      try {
        state = applyOp(state, entry.op, {
          by: this.by,
          byName: this.byName,
          ts: entry.ts,
        }).state;
      } catch {
        /* A foreign delete may invalidate an optimistic patch until the server rejects it. */
      }
    }
    this.view = state;
    this.onChange();
  }
}
