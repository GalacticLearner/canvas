/** Pure deterministic board reducer; batches commit atomically or throw without mutating input. */
import { ProtocolError, LIMITS } from "./constants";
import {connectorPoints} from './geometry';
import { boardSchema, elementSchema, type BoardState, type Op } from "./model";
/** Authority context replaces all client-supplied authorship and timestamps. */
export interface ApplyContext {
  by: string;
  byName: string;
  ts: number;
}
/** Result includes an inverse captured against the state before this gesture. */
export interface ApplyResult {
  state: BoardState;
  changedIds: string[];
  inverse: Op;
}
/** Apply one operation. Callers assign the room sequence only after successful completion. */
export function applyOp(
  input: BoardState,
  op: Op,
  ctx: ApplyContext,
  depth = 0,
): ApplyResult {
  if (depth > 8)
    throw new ProtocolError("INVALID_OP", "Batch nesting exceeds limit");
  const state: BoardState = {
    ...input,
    elements: { ...input.elements },
    frames: [...input.frames],
  };
  let changedIds: string[] = [];
  let inverse: Op = { kind: "batch", ops: [] };
  switch (op.kind) {
    case "add": {
      if (state.elements[op.el.id])
        throw new ProtocolError("INVALID_OP", "Element already exists");
      if (Object.keys(state.elements).length >= LIMITS.maxElements)
        throw new ProtocolError("TOO_LARGE", "Board is full");
      const el = elementSchema.parse({
        ...op.el,
        authorId: ctx.by,
        authorName: ctx.byName,
        createdAt: ctx.ts,
        updatedAt: ctx.ts,
        ver: 1,
      });
      state.elements[el.id] = el;
      if (el.type === "frame") state.frames.push(el.id);
      changedIds = [el.id];
      inverse = { kind: "remove", ids: [el.id] };
      break;
    }
    case "patch": {
      const old = state.elements[op.id];
      if (!old)
        throw new ProtocolError("TARGET_MISSING", "Element was removed");
      const safe = { ...op.set };
      for (const k of [
        "id",
        "type",
        "authorId",
        "authorName",
        "createdAt",
        "ver",
        "updatedAt",
      ])
        delete (safe as Record<string, unknown>)[k];
      const previous: Record<string, unknown> = {};
      for (const k of Object.keys(safe))
        previous[k] = (old as unknown as Record<string, unknown>)[k] ?? (['groupId','frameId','parentId'].includes(k)?null:undefined);
      state.elements[op.id] = elementSchema.parse({
        ...old,
        ...safe,
        updatedAt: ctx.ts,
        ver: old.ver + 1,
      });
      changedIds = [op.id];
      inverse = { kind: "patch", id: op.id, set: previous };
      break;
    }
    case "remove": {
      const removed = op.ids.map((id) => state.elements[id]).filter(Boolean);
      const inverseBindings:Op[]=[];
      // Freeze the final derived endpoint before deleting its target, so a connector never jumps.
      for(const el of Object.values(state.elements))if((el.start&&op.ids.includes(el.start.elId))||(el.end&&op.ids.includes(el.end.elId))){if(op.ids.includes(el.id))continue;inverseBindings.push({kind:'patch',id:el.id,set:{start:el.start||null,end:el.end||null,points:el.points}});state.elements[el.id]={...el,points:connectorPoints(el,state.elements),start:el.start&&op.ids.includes(el.start.elId)?null:el.start,end:el.end&&op.ids.includes(el.end.elId)?null:el.end,ver:el.ver+1,updatedAt:ctx.ts};changedIds.push(el.id);}
      for (const el of removed) delete state.elements[el.id];
      state.frames = state.frames.filter((id) => !op.ids.includes(id));
      changedIds.push(...removed.map((el) => el.id));
      inverse = {
        kind: "batch",
        ops: [...removed.map((el):Op => ({ kind: "add", el })),...inverseBindings],
      };
      break;
    }
    case "clear": {
      changedIds = Object.keys(state.elements);
      inverse = {
        kind: "batch",
        ops: Object.values(state.elements).map((el) => ({ kind: "add", el })),
      };
      state.elements = {};
      state.frames = [];
      break;
    }
    case "replace_state": {
      const parsed = boardSchema.parse(op.state);
      changedIds = [
        ...new Set([
          ...Object.keys(state.elements),
          ...Object.keys(parsed.elements),
        ]),
      ];
      inverse = { kind: "replace_state", state: input };
      state.elements = { ...parsed.elements };
      state.frames = [...parsed.frames];
      break;
    }
    case "frames_order": {
      if (
        new Set(op.ids).size !== state.frames.length ||
        op.ids.length !== state.frames.length ||
        op.ids.some((id) => !state.frames.includes(id))
      )
        throw new ProtocolError(
          "INVALID_OP",
          "Frame order must be a permutation",
        );
      inverse = { kind: "frames_order", ids: state.frames };
      state.frames = [...op.ids];
      break;
    }
    case "batch": {
      const inverses: Op[] = [];
      let current = state;
      for (const child of op.ops) {
        const result = applyOp(current, child, ctx, depth + 1);
        current = result.state;
        changedIds.push(...result.changedIds);
        inverses.unshift(result.inverse);
      }
      return {
        state: current,
        changedIds: [...new Set(changedIds)],
        inverse: { kind: "batch", ops: inverses },
      };
    }
  }
  return { state, changedIds, inverse };
}
