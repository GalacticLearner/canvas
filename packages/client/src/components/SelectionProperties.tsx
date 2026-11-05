/** Selection editing emits one atomic gesture for styles, layout, grouping and layer changes. */
import { generateKeyBetween } from "fractional-indexing";
import { Button } from "./ui";
import { submit, useWorkspace } from "../stores/workspace";
import { can, type Element, type Op } from "../../../shared/src/index";
/** Contextual controls edit selected content while preserving each element's unmodified properties. */
export function SelectionProperties({ ids }: { ids: string[] }) {
  const s = useWorkspace(),
    items = ids.map((id) => s.board.elements[id]).filter(Boolean),
    first = items[0];
  if (!first) return null;
  const patch = (set: Partial<Element>) =>
    submit({
      kind: "batch",
      ops: items.map((el) => ({ kind: "patch", id: el.id, set })),
    });
  const style = (set: Partial<Element["style"]>) =>
    submit({
      kind: "batch",
      ops: items.map((el) => ({
        kind: "patch",
        id: el.id,
        set: { style: set },
      })),
    });
  const layout = (action: string) => {
    const axis =
        action.includes("vertical") ||
        ["top", "bottom", "middle"].includes(action)
          ? "y"
          : "x",
      dimension = axis === "x" ? "w" : "h";
    const sorted = [...items].sort((a, b) => a[axis] - b[axis]),
      low = Math.min(...items.map((el) => el[axis])),
      high = Math.max(...items.map((el) => el[axis] + (el[dimension] || 0))),
      center = (low + high) / 2;
    const occupied = items.reduce((n, el) => n + (el[dimension] || 0), 0),
      gap = items.length > 1 ? (high - low - occupied) / (items.length - 1) : 0;
    let cursor = low;
    const ops: Op[] = sorted.map((el) => {
      const size = el[dimension] || 0;
      const value = action.startsWith("distribute")
        ? cursor
        : ["right", "bottom"].includes(action)
          ? high - size
          : ["center", "middle"].includes(action)
            ? center - size / 2
            : low;
      cursor += size + gap;
      const delta = value - el[axis];
      return {
        kind: "patch",
        id: el.id,
        set: {
          [axis]: value,
          ...(el.points
            ? {
                points: el.points.map((n, i) =>
                  i % 2 === (axis === "x" ? 0 : 1) ? n + delta : n,
                ),
              }
            : {}),
        },
      };
    });
    submit({ kind: "batch", ops });
  };
  const layer = (direction: string) => {
    const all = Object.values(s.board.elements)
      .filter((el) => !ids.includes(el.id))
      .sort((a, b) => a.z.localeCompare(b.z));
    let before: string | null = null,
      after: string | null = null;
    if (direction === "front") before = all.at(-1)?.z || null;
    else if (direction === "back") after = all[0]?.z || null;
    else {
      const at = all.findIndex((el) => el.z > first.z);
      if (direction === "forward") {
        const index = at < 0 ? all.length : at;
        before = all[index]?.z || all.at(-1)?.z || null;
        after = all[index + 1]?.z || null;
      } else {
        const index = (at < 0 ? all.length : at) - 1;
        before = all[index - 1]?.z || null;
        after = all[index]?.z || null;
      }
    }
    const ops: Op[] = items.map((el) => {
      const z = generateKeyBetween(before, after);
      before = z;
      return { kind: "patch", id: el.id, set: { z } };
    });
    submit({ kind: "batch", ops });
  };
  return (
    <details className="selection-properties">
      <summary>
        Edit {items.length === 1 ? first.type : items.length + " elements"}
      </summary>
      <fieldset
        disabled={!can(s.you.role, "draw", s.settings)}
        className="selection-fields"
      >
        <label>
          Font size
          <input
            type="number"
            min={8}
            max={200}
            value={first.fontSize || first.style.fontSize || 20}
            onChange={(e) => {
              const n = Math.max(
                8,
                Math.min(200, Number(e.target.value) || 20),
              );
              patch({ fontSize: n });
            }}
          />
        </label>
        <Button
          aria-pressed={!!first.style.bold}
          onClick={() => style({ bold: !first.style.bold })}
        >
          Bold
        </Button>
        <Button
          aria-pressed={!!first.style.italic}
          onClick={() => style({ italic: !first.style.italic })}
        >
          Italic
        </Button>
        <label>
          Text alignment
          <select
            value={first.style.align || "left"}
            onChange={(e) => style({ align: e.target.value as "left" })}
          >
            {["left", "center", "right"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Fill
          <input
            type="color"
            value={first.style.fill || "#ffffff"}
            onChange={(e) => style({ fill: e.target.value })}
          />
        </label>
        <Button onClick={() => style({ fill: null })}>No fill</Button>
        <label>
          Line width
          <input
            type="number"
            min={1}
            max={40}
            value={first.style.strokeWidth}
            onChange={(e) =>
              style({
                strokeWidth: Math.max(
                  1,
                  Math.min(40, Number(e.target.value) || 1),
                ),
              })
            }
          />
        </label>
        <label>
          Opacity
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.1}
            value={first.style.opacity}
            onChange={(e) => style({ opacity: Number(e.target.value) })}
          />
        </label>
        <label>
          Dash
          <select
            value={first.style.dash}
            onChange={(e) => style({ dash: e.target.value as "solid" })}
          >
            {["solid", "dashed", "dotted"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        {first.type === "sticky" && (
          <label>
            Note color
            <select
              value={first.color || "#F3D98B"}
              onChange={(e) => patch({ color: e.target.value })}
            >
              {["#F3D98B", "#D5E7CE", "#CFE1EF", "#F0D3D7", "#E1D5EE"].map(
                (v) => (
                  <option key={v}>{v}</option>
                ),
              )}
            </select>
          </label>
        )}
        {["line", "arrow"].includes(first.type) && (
          <>
            <label>
              Route
              <select
                value={first.route || "straight"}
                onChange={(e) => patch({ route: e.target.value as "straight" })}
              >
                {["straight", "elbow", "curve"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            {(["start", "end"] as const).map((endpoint) => (
              <label key={endpoint}>
                {endpoint} head
                <select
                  value={first[(endpoint + "Head") as "startHead"] || "none"}
                  onChange={(e) =>
                    patch({ [endpoint + "Head"]: e.target.value })
                  }
                >
                  {["none", "arrow", "dot", "diamond"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
                {first[endpoint] && (
                  <select
                    aria-label={`${endpoint} anchor`}
                    value={first[endpoint]!.anchor}
                    onChange={(e) =>
                      patch({
                        [endpoint]: {
                          ...first[endpoint],
                          anchor: e.target.value,
                        },
                      })
                    }
                  >
                    {["auto", "top", "right", "bottom", "left"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                )}
              </label>
            ))}
          </>
        )}
        <label>
          Arrange
          <select
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) layout(e.target.value);
              e.target.value = "";
            }}
          >
            <option value="">Align / distribute…</option>
            {[
              "left",
              "center",
              "right",
              "top",
              "middle",
              "bottom",
              "distribute horizontal",
              "distribute vertical",
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Layer
          <select
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) layer(e.target.value);
              e.target.value = "";
            }}
          >
            <option value="">Change layer…</option>
            {["front", "forward", "backward", "back"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <Button onClick={() => patch({ groupId: crypto.randomUUID() })}>
          Group
        </Button>
        <Button onClick={() => patch({ groupId: null })}>Ungroup</Button>
      </fieldset>
    </details>
  );
}
