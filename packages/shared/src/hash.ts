/** Stable integrity checks include actual content, catching corruption beyond version changes. */
import type { BoardState } from "./model";
const elementHashes = new WeakMap<object, number>();
function stable(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => JSON.stringify(k) + ":" + stable(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
/** FNV-1a is fast and deterministic; this detects accidental divergence, not hostile tampering. */
export function stateHash(state: BoardState): string {
  const fnv = (text: string) => {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  };
  // Reducer elements are immutable: cache content hashes by object identity, then combine commutatively.
  let sum = fnv(stable({ seq: state.seq, frames: state.frames }));
  for (const [id, el] of Object.entries(state.elements)) {
    let hash = elementHashes.get(el);
    if (hash === undefined) {
      hash = fnv(id + "|" + el.ver + "|" + stable(el));
      elementHashes.set(el, hash);
    }
    sum = (sum + hash) >>> 0;
  }
  return sum.toString(16).padStart(8, "0");
}
