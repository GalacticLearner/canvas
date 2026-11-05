/** Acceptance regressions cover adversarial framing, connector deletion and randomized own undo. */
import { it, expect } from "vitest";
import {
  FrameDecoder,
  encodeFrame,
  encodeFrames,
  applyOp,
  makeElement,
  emptyBoard,
  stateHash,
  UndoManager,
  connectorPoints,
  layoutMindMap,
  type Op,
} from "./index";
it("merges independent style fields and undoes only the changed field", () => {
  const ctx = { by: "a", byName: "Ada", ts: 1 };
  let state = applyOp(
    emptyBoard(),
    { kind: "add", el: makeElement("rect", "r") },
    ctx,
  ).state;
  const first = applyOp(
    state,
    { kind: "patch", id: "r", set: { style: { stroke: "#0072B2" } } },
    ctx,
  );
  state = applyOp(
    first.state,
    { kind: "patch", id: "r", set: { style: { fill: "#F3D98B" } } },
    { ...ctx, by: "b" },
  ).state;
  const undone = applyOp(state, first.inverse, ctx).state;
  expect(undone.elements.r.style.fill).toBe("#F3D98B");
  expect(undone.elements.r.style.stroke).toBe("#243E36");
});
it("rejects invalid transport transfers without accepting partial snapshots", () => {
  for (const p of [
    { idx: 1, total: 2, data: "AA==", transferId: "t" },
    { idx: 0, total: 100, data: "AA==", transferId: "t" },
    {
      idx: 0,
      total: 1,
      data: Buffer.from("{").toString("base64"),
      transferId: "t",
    },
  ])
    expect(() =>
      new FrameDecoder().push(encodeFrame({ v: 1, t: "transfer_chunk", p })),
    ).toThrow();
  expect(() => encodeFrame("x".repeat(4 * 1024 * 1024))).toThrow();
  expect(encodeFrames({ ok: true })).toHaveLength(1);
});
it("freezes deleted connector endpoints and restores the binding with undo", () => {
  const ctx = { by: "a", byName: "Ada", ts: 1 };
  let board = emptyBoard();
  const target = makeElement("rect", "target", 100, 100),
    line = makeElement("arrow", "line");
  line.points = [0, 0, 20, 20];
  line.end = { elId: target.id, anchor: "right" };
  board = applyOp(
    board,
    {
      kind: "batch",
      ops: [
        { kind: "add", el: target },
        { kind: "add", el: line },
      ],
    },
    ctx,
  ).state;
  const before = connectorPoints(board.elements.line, board.elements);
  const removed = applyOp(board, { kind: "remove", ids: ["target"] }, ctx);
  expect(removed.state.elements.line.end).toBeNull();
  expect(removed.state.elements.line.points).toEqual(before);
  const restored = applyOp(removed.state, removed.inverse, ctx).state;
  expect(restored.elements.line.end?.elId).toBe("target");
});
it("routes backward-facing elbows outside both target interiors and lays out branches without overlap", () => {
  const a = makeElement("rect", "a", 100, 100),
    b = makeElement("rect", "b", 400, 100),
    line = makeElement("arrow", "l");
  line.points = [100, 150, 560, 150];
  line.start = { elId: "a", anchor: "left" };
  line.end = { elId: "b", anchor: "right" };
  line.route = "elbow";
  const points = connectorPoints(line, { a, b });
  expect(points.length).toBeGreaterThan(4);
  for (let i = 2; i < points.length; i += 2)
    expect(points[i] === points[i - 2] || points[i + 1] === points[i - 1]).toBe(
      true,
    );
  const nodes = [
    makeElement("mindnode", "r"),
    ...Array.from({ length: 4 }, (_, i) => ({
      ...makeElement("mindnode", "c" + i),
      parentId: "r",
      side: "right" as const,
    })),
  ];
  const layout = layoutMindMap(nodes, "r");
  expect(new Set(nodes.slice(1).map((n) => layout.get(n.id)?.y)).size).toBe(4);
});
it("five replicas converge across 2000 seeded random edits including own undo and redo", () => {
  let seed = 0x12345678;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const replicas = Array.from({ length: 5 }, emptyBoard),
    histories = Array.from({ length: 5 }, () => new UndoManager());
  for (let i = 0; i < 2000; i++) {
    const user = Math.floor(random() * 5),
      state = replicas[0],
      ids = Object.keys(state.elements),
      choice = random();
    let op: Op | null = null,
      record = true;
    if (choice < 0.15) {
      op = histories[user].undo(state);
      record = false;
    } else if (choice < 0.25) {
      op = histories[user].redo(state);
      record = false;
    } else if (choice < 0.55 || !ids.length)
      op = { kind: "add", el: makeElement("rect", "r" + i) };
    else {
      const id = ids[Math.floor(random() * ids.length)];
      op =
        choice < 0.85
          ? { kind: "patch", id, set: { x: Math.round(random() * 1000) } }
          : { kind: "remove", ids: [id] };
    }
    if (!op) continue;
    const ctx = { by: "u" + user, byName: "User " + user, ts: i };
    const result = applyOp(state, op, ctx);
    if (record) histories[user].record(op, result.inverse);
    for (let r = 0; r < 5; r++) {
      replicas[r] = applyOp(replicas[r], op, ctx).state;
      replicas[r].seq = i;
    }
    expect(new Set(replicas.map(stateHash)).size).toBe(1);
  }
});
