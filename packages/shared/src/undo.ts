/** Per-user gesture history emits inverse operations into the normal authoritative stream. */
import type { BoardState, Op } from "./model";
/** Remove inverses whose targets disappeared, preserving valid portions of clear/batch undo. */
export function applicable(op: Op, state: BoardState): Op | null {
  switch (op.kind) {
    case "add":
      return state.elements[op.el.id] ? null : op;
    case "patch":
      return state.elements[op.id] ? op : null;
    case "remove": {
      const ids = op.ids.filter((id) => state.elements[id]);
      return ids.length ? { ...op, ids } : null;
    }
    case "batch": {
      const ops = op.ops
        .map((o) => applicable(o, state))
        .filter((o): o is Op => !!o);
      return ops.length ? { kind: "batch", ops } : null;
    }
    default:
      return op;
  }
}
/** Own actions only; remote changes never enter these stacks. */
export class UndoManager {
  private past: { forward: Op; inverse: Op }[] = [];
  private future: { forward: Op; inverse: Op }[] = [];
  /** Record one gesture and invalidate redo after a fresh edit. */
  record(forward: Op, inverse: Op) {
    this.past.push({ forward, inverse });
    if (this.past.length > 200) this.past.shift();
    this.future = [];
  }
  /** Undo remains last-writer-wins for the exact changed properties. */
  undo(state: BoardState): Op | null {
    while (this.past.length) {
      const entry = this.past.pop()!;
      const op = applicable(entry.inverse, state);
      if (op) {
        this.future.push(entry);
        return op;
      }
    }
    return null;
  }
  /** Redo follows the same missing-target rules. */
  redo(state: BoardState): Op | null {
    while (this.future.length) {
      const entry = this.future.pop()!;
      const op = applicable(entry.forward, state);
      if (op) {
        this.past.push(entry);
        return op;
      }
    }
    return null;
  }
  /** Toolbar availability. */
  get canUndo() {
    return this.past.length > 0;
  }
  /** Toolbar availability. */
  get canRedo() {
    return this.future.length > 0;
  }
}
