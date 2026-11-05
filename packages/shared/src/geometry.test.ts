/** Geometry and history conflicts cover boundaries that affect all collaborative clients. */
import { it, expect } from "vitest";
import {
  makeElement,
  bounds,
  hitTest,
  anchor,
  connectorPoints,
  layoutMindMap,
  contains,
  rotate,
  UndoManager,
  applicable,
  emptyBoard,
  applyOp,
} from "./index";
const ctx = { by: "a", byName: "Ada", ts: 1 };
it("bounds, rotated selection and bound connectors stay deterministic", () => {
  const el = makeElement("rect", "a", 10, 20);
  el.w = 100;
  el.h = 50;
  expect(hitTest(el, 60, 40)).toBe(true);
  expect(hitTest(el, -100, -100)).toBe(false);
  expect(bounds(el).minX).toBeLessThan(10);
  expect(anchor(el, "right")).toEqual({ x: 110, y: 45 });
  const line = makeElement("arrow", "c");
  line.points = [0, 0, 200, 200];
  line.start = { elId: "a", anchor: "right" };
  line.route = "elbow";
  expect(connectorPoints(line, { a: el })).toEqual([
    110, 45, 155, 45, 155, 200, 200, 200,
  ]);
  expect(rotate(1, 0, 0, 0, Math.PI / 2).y).toBeCloseTo(1);
});
it("mind maps stop cycles and frame membership uses centers", () => {
  const root = makeElement("mindnode", "r"),
    child = makeElement("mindnode", "c");
  child.parentId = "r";
  child.side = "left";
  expect(layoutMindMap([root, child], "r").get("c")!.x).toBe(-240);
  expect(layoutMindMap([root], "missing").size).toBe(0);
  const frame = makeElement("frame", "f");
  frame.w = 500;
  frame.h = 500;
  expect(contains(frame, root)).toBe(true);
});
it("undo drops concurrent removes and only re-adds absent ids after clear", () => {
  const manager = new UndoManager(),
    el = makeElement("rect", "r");
  const added = applyOp(emptyBoard(), { kind: "add", el }, ctx);
  manager.record({ kind: "add", el }, added.inverse);
  expect(manager.canUndo).toBe(true);
  expect(manager.undo(emptyBoard())).toBeNull();
  expect(manager.canRedo).toBe(false);
  expect(applicable({ kind: "add", el }, added.state)).toBeNull();
  expect(
    applicable({ kind: "patch", id: "missing", set: { x: 1 } }, added.state),
  ).toBeNull();
  expect(
    applicable(
      {
        kind: "batch",
        ops: [
          { kind: "add", el },
          { kind: "add", el: { ...el, id: "new" } },
        ],
      },
      added.state,
    ),
  ).toEqual({
    kind: "batch",
    ops: [{ kind: "add", el: { ...el, id: "new" } }],
  });
  expect(applicable({ kind: "clear" }, added.state)).toEqual({ kind: "clear" });
  manager.record({ kind: "add", el }, added.inverse);
  manager.undo(added.state);
  expect(manager.canRedo).toBe(true);
  expect(manager.redo(added.state)).toBeNull();
});
