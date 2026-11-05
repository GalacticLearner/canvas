/** Recovery tests inject delayed, duplicate, missing and corrupted authority updates. */
import { it, expect } from "vitest";
import { SyncEngine } from "./SyncEngine";
import {
  makeElement,
  msg,
  stateHash,
  emptyBoard,
  applyOp,
  type Envelope,
} from "../../../shared/src/index";
const ctx = { by: "a", byName: "Ada", ts: 1 };
it("optimistically applies, acknowledges and rejects without retaining speculative state", () => {
  const sent: Envelope[] = [];
  const engine = new SyncEngine((e) => sent.push(e));
  const id = engine.submit({ kind: "add", el: makeElement("rect", "r") });
  expect(engine.view.elements.r).toBeDefined();
  expect(engine.confirmed.elements.r).toBeUndefined();
  engine.receive(
    msg("op_applied", {
      seq: 1,
      opId: id,
      by: "a",
      byName: "Ada",
      ts: 1,
      op: sent[0].p.op,
    }),
  );
  expect(engine.pending).toHaveLength(0);
  expect(engine.confirmed.seq).toBe(1);
  const patch = engine.submit({ kind: "patch", id: "r", set: { x: 20 } });
  engine.receive(
    msg("op_rejected", {
      opId: patch,
      code: "READ_ONLY",
      message: "Read only",
    }),
  );
  expect(engine.view.elements.r.x).toBe(0);
});
it("buffers gaps, ignores duplicates and requests snapshots after a bad checkpoint", () => {
  const sent: Envelope[] = [];
  const engine = new SyncEngine((e) => sent.push(e));
  const first = {
      seq: 1,
      opId: "1",
      by: "a",
      byName: "Ada",
      ts: 1,
      op: { kind: "add" as const, el: makeElement("rect", "r") },
    },
    second = {
      seq: 2,
      opId: "2",
      by: "a",
      byName: "Ada",
      ts: 2,
      op: { kind: "patch" as const, id: "r", set: { x: 20 } },
    };
  engine.receive(msg("op_applied", second));
  expect(sent.at(-1)?.t).toBe("sync_req");
  engine.receive(
    msg("sync_delta", { fromSeq: 0, toSeq: 2, ops: [first, second] }),
  );
  expect(engine.confirmed.seq).toBe(2);
  expect(engine.view.elements.r.x).toBe(20);
  const hash = stateHash(engine.view);
  engine.receive(msg("op_applied", second));
  expect(stateHash(engine.view)).toBe(hash);
  engine.receive(msg("checkpoint", { seq: 2, hash: "wrong", count: 1 }));
  expect(sent.at(-1)?.p.fromSeq).toBe(-1);
});
it("replays pending over a foreign change and resends original ids", () => {
  const sent: Envelope[] = [];
  const engine = new SyncEngine((e) => sent.push(e));
  engine.snapshot(
    applyOp(emptyBoard(), { kind: "add", el: makeElement("rect", "r") }, ctx)
      .state,
  );
  engine.submit({ kind: "patch", id: "r", set: { x: 50 } });
  engine.receive(
    msg("op_applied", {
      seq: 1,
      opId: "foreign",
      by: "b",
      byName: "Ben",
      ts: 2,
      op: { kind: "patch", id: "r", set: { y: 40 } },
    }),
  );
  expect(engine.view.elements.r).toMatchObject({ x: 50, y: 40 });
  engine.resend();
  expect(sent.at(-1)?.p.opId).toBe(sent[0].p.opId);
});
