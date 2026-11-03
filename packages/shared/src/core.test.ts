/** Shared-core regressions cover byte boundaries, atomicity and multi-replica convergence. */
import { describe, it, expect } from "vitest";
import {
  FrameDecoder,
  encodeFrame,
  applyOp,
  makeElement,
  emptyBoard,
  stateHash,
  UndoManager,
  simplify,
  parseEnvelope,
  msg,
  can,
  defaultSettings,
} from "./index";
const ctx = { by: "a", byName: "Ada", ts: 1 };
describe("framing", () => {
  it("handles every split and coalescing", () => {
    const frame = encodeFrame({ value: "λ" });
    for (let i = 0; i <= frame.length; i++) {
      const decoder = new FrameDecoder();
      expect([
        ...decoder.push(frame.subarray(0, i)),
        ...decoder.push(frame.subarray(i)),
      ]).toEqual([{ value: "λ" }]);
    }
    expect(new FrameDecoder().push(Buffer.concat([frame, frame]))).toHaveLength(
      2,
    );
  });
  it("rejects zero, oversize, malformed JSON and UTF8", () => {
    for (const bytes of [
      Buffer.alloc(4),
      Buffer.from([0, 65, 0, 0]),
      Buffer.from([0, 0, 0, 1, 123]),
      Buffer.from([0, 0, 0, 1, 255]),
    ])
      expect(() => new FrameDecoder().push(bytes)).toThrow();
  });
  it("decodes 10000 deterministically fragmented frames", () => {
    const decoder = new FrameDecoder();
    for (let i = 0; i < 10000; i++) {
      const frame = encodeFrame({ i, s: "x".repeat(i % 81) }),
        cut = i % frame.length;
      expect([
        ...decoder.push(frame.subarray(0, cut)),
        ...decoder.push(frame.subarray(cut)),
      ]).toEqual([{ i, s: "x".repeat(i % 81) }]);
    }
  });
});
describe("reducer and undo", () => {
  it("overwrites spoofed authorship and rolls back failed batches", () => {
    const state = emptyBoard(),
      el = makeElement("rect", "r");
    const next = applyOp(state, { kind: "add", el }, ctx);
    expect(next.state.elements.r.authorName).toBe("Ada");
    expect(() =>
      applyOp(
        next.state,
        {
          kind: "batch",
          ops: [
            { kind: "remove", ids: ["r"] },
            { kind: "patch", id: "missing", set: { x: 2 } },
          ],
        },
        ctx,
      ),
    ).toThrow();
    expect(next.state.elements.r).toBeDefined();
    expect(state.elements).toEqual({});
  });
  it("undoes own changed properties and skips missing targets", () => {
    const manager = new UndoManager();
    let state = applyOp(
      emptyBoard(),
      { kind: "add", el: makeElement("rect", "r") },
      ctx,
    ).state;
    const op = { kind: "patch" as const, id: "r", set: { x: 20 } };
    const result = applyOp(state, op, ctx);
    manager.record(op, result.inverse);
    state = applyOp(
      result.state,
      { kind: "patch", id: "r", set: { y: 99 } },
      ctx,
    ).state;
    state = applyOp(state, manager.undo(state)!, ctx).state;
    expect(state.elements.r.x).toBe(0);
    expect(state.elements.r.y).toBe(99);
    expect(manager.redo(state)).toEqual(op);
  });
  it("five replicas converge through 2000 ordered operations", () => {
    const states = Array.from({ length: 5 }, emptyBoard);
    for (let i = 0; i < 2000; i++) {
      const op =
        i % 3 === 0
          ? { kind: "add" as const, el: makeElement("rect", "e" + i) }
          : i % 3 === 1
            ? { kind: "patch" as const, id: "e" + (i - 1), set: { x: i } }
            : { kind: "remove" as const, ids: ["e" + (i - 2)] };
      for (let r = 0; r < states.length; r++)
        states[r] = applyOp(states[r], op, { ...ctx, ts: i }).state;
    }
    expect(new Set(states.map(stateHash)).size).toBe(1);
  });
  it("validates order and restores state", () => {
    const s = applyOp(
      emptyBoard(),
      { kind: "add", el: makeElement("frame", "f") },
      ctx,
    ).state;
    expect(() =>
      applyOp(s, { kind: "frames_order", ids: ["bad"] }, ctx),
    ).toThrow();
    expect(
      applyOp(s, { kind: "frames_order", ids: ["f"] }, ctx).state.frames,
    ).toEqual(["f"]);
    const clear = applyOp(s, { kind: "clear" }, ctx);
    expect(
      Object.keys(applyOp(clear.state, clear.inverse, ctx).state.elements),
    ).toEqual(["f"]);
    expect(
      applyOp(s, { kind: "replace_state", state: emptyBoard() }, ctx).state
        .elements,
    ).toEqual({});
  });
});
it("enforces protocol and permission boundaries", () => {
  expect(parseEnvelope(msg("ping", { n: 1 })).p.n).toBe(1);
  expect(() => parseEnvelope({ v: 1, t: "unknown", p: {} })).toThrow();
  expect(() => parseEnvelope({ v: 9, t: "ping", p: { n: 1 } })).toThrow();
  expect(can("viewer", "draw", defaultSettings)).toBe(false);
  expect(can("editor", "clear", defaultSettings)).toBe(false);
  expect(simplify([0, 0, 1, 1, 2, 2], 0.1)).toEqual([0, 0, 2, 2]);
});
