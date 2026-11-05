/** Shared geometry keeps selection, exports, connectors and mind maps consistent. */
import type { Element } from "./model";
/** Axis-aligned world rectangle. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
/** Rotate around an arbitrary center. */
export function rotate(
  x: number,
  y: number,
  cx: number,
  cy: number,
  angle: number,
) {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return {
    x: cx + (x - cx) * c - (y - cy) * s,
    y: cy + (x - cx) * s + (y - cy) * c,
  };
}
/** Rotated bounding box, including stroke thickness. */
export function bounds(
  el: Element,
  elements?: Record<string, Element>,
): Bounds {
  if (
    elements &&
    (el.type === "arrow" || el.type === "line") &&
    (el.start || el.end)
  )
    return bounds({ ...el, points: connectorPoints(el, elements) });
  const pts = el.points?.length
    ? Array.from({ length: el.points.length / 2 }, (_, i) => ({
        x: el.points![i * 2],
        y: el.points![i * 2 + 1],
      }))
    : [
        { x: el.x, y: el.y },
        { x: el.x + (el.w || 0), y: el.y },
        { x: el.x + (el.w || 0), y: el.y + (el.h || 0) },
        { x: el.x, y: el.y + (el.h || 0) },
      ];
  const rotated = pts.map((p) =>
    rotate(
      p.x,
      p.y,
      el.x + (el.w || 0) / 2,
      el.y + (el.h || 0) / 2,
      el.angle || 0,
    ),
  );
  const pad = el.style.strokeWidth / 2;
  return {
    minX: Math.min(...rotated.map((p) => p.x)) - pad,
    minY: Math.min(...rotated.map((p) => p.y)) - pad,
    maxX: Math.max(...rotated.map((p) => p.x)) + pad,
    maxY: Math.max(...rotated.map((p) => p.y)) + pad,
  };
}
/** Distance to a finite line segment. */
export function segmentDistance(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) {
  const dx = bx - ax,
    dy = by - ay;
  const t = Math.max(
    0,
    Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}
/** Hit-test paths precisely and closed primitives in their unrotated local space. */
export function hitTest(
  el: Element,
  x: number,
  y: number,
  tolerance = 6,
  elements?: Record<string, Element>,
) {
  if (
    elements &&
    (el.type === "arrow" || el.type === "line") &&
    (el.start || el.end)
  )
    return hitTest(
      { ...el, points: connectorPoints(el, elements) },
      x,
      y,
      tolerance,
    );
  const local = rotate(
    x,
    y,
    el.x + (el.w || 0) / 2,
    el.y + (el.h || 0) / 2,
    -(el.angle || 0),
  );
  if (el.points?.length) {
    if (el.points.length === 2)
      return (
        Math.hypot(local.x - el.points[0], local.y - el.points[1]) <=
        tolerance + el.style.strokeWidth / 2
      );
    for (let i = 2; i < el.points.length; i += 2)
      if (
        segmentDistance(
          local.x,
          local.y,
          el.points[i - 2],
          el.points[i - 1],
          el.points[i],
          el.points[i + 1],
        ) <=
        tolerance + el.style.strokeWidth / 2
      )
        return true;
    return false;
  }
  const p = rotate(
    x,
    y,
    el.x + (el.w || 0) / 2,
    el.y + (el.h || 0) / 2,
    -(el.angle || 0),
  );
  const w = el.w || 1,
    h = el.h || 1;
  const nx = (p.x - el.x) / w,
    ny = (p.y - el.y) / h;
  if (el.type === "ellipse")
    return ((nx - 0.5) * 2) ** 2 + ((ny - 0.5) * 2) ** 2 <= 1.1;
  if (el.type === "diamond")
    return Math.abs(nx - 0.5) + Math.abs(ny - 0.5) <= 0.55;
  if (el.type === "triangle")
    return ny >= 0 && ny <= 1 && Math.abs(nx - 0.5) <= ny / 2 + tolerance / w;
  if (el.type === "parallelogram")
    return (
      ny >= 0 &&
      ny <= 1 &&
      nx >= 0.2 * (1 - ny) - tolerance / w &&
      nx <= 1 - 0.2 * ny + tolerance / w
    );
  if (el.type === "hexagon")
    return (
      ny >= 0 &&
      ny <= 1 &&
      nx >= 0.2 * Math.abs(ny - 0.5) * 2 - tolerance / w &&
      nx <= 1 - 0.2 * Math.abs(ny - 0.5) * 2 + tolerance / w
    );
  return (
    nx >= -tolerance / w &&
    nx <= 1 + tolerance / w &&
    ny >= -tolerance / h &&
    ny <= 1 + tolerance / h
  );
}
/** Visibility is shared by rendering, hit testing and SVG export when branches are collapsed. */
export function isVisible(el: Element, elements: Record<string, Element>) {
  let id = el.parentId;
  const seen = new Set<string>();
  while (id && elements[id] && !seen.has(id)) {
    seen.add(id);
    if (elements[id].collapsed) return false;
    id = elements[id].parentId;
  }
  return true;
}
/** Scale a path or shape around a fixed world-space origin. */
export function scaleElement(
  el: Element,
  origin: { x: number; y: number },
  sx: number,
  sy: number,
): Element {
  return {
    ...el,
    x: origin.x + (el.x - origin.x) * sx,
    y: origin.y + (el.y - origin.y) * sy,
    w: el.w === undefined ? undefined : el.w * sx,
    h: el.h === undefined ? undefined : el.h * sy,
    points: el.points?.map((n, i) =>
      i % 2 ? origin.y + (n - origin.y) * sy : origin.x + (n - origin.x) * sx,
    ),
  };
}
/** Cubic control points use a shared horizontal midpoint for predictable connector curves. */
export function curveControls(
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  return [
    { x: (a.x + b.x) / 2, y: a.y },
    { x: (a.x + b.x) / 2, y: b.y },
  ];
}
/** Snap a moving selection to nearby edges/centers and return the corresponding guide lines. */
export function snapMove(
  moving: Element[],
  others: Element[],
  dx: number,
  dy: number,
  tolerance: number,
) {
  let bestX = tolerance,
    bestY = tolerance;
  const guides: { axis: "x" | "y"; value: number }[] = [];
  let correctionX = 0,
    correctionY = 0;
  for (const el of moving) {
    const x = el.x + dx,
      y = el.y + dy;
    for (const other of others) {
      for (const a of [x, x + (el.w || 0) / 2, x + (el.w || 0)])
        for (const b of [
          other.x,
          other.x + (other.w || 0) / 2,
          other.x + (other.w || 0),
        ])
          if (Math.abs(b - a) < bestX) {
            bestX = Math.abs(b - a);
            correctionX = b - a;
            guides[0] = { axis: "x", value: b };
          }
      for (const a of [y, y + (el.h || 0) / 2, y + (el.h || 0)])
        for (const b of [
          other.y,
          other.y + (other.h || 0) / 2,
          other.y + (other.h || 0),
        ])
          if (Math.abs(b - a) < bestY) {
            bestY = Math.abs(b - a);
            correctionY = b - a;
            guides[1] = { axis: "y", value: b };
          }
    }
  }
  return {
    dx: dx + correctionX,
    dy: dy + correctionY,
    guides: guides.filter(Boolean),
  };
}
/** Iterative RDP avoids call-stack failure for long stylus strokes. */
export function simplify(points: number[], epsilon: number): number[] {
  if (points.length <= 4) return points;
  const keep = new Set([0, points.length - 2]),
    stack = [[0, points.length - 2]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let max = epsilon,
      idx = -1;
    for (let i = a + 2; i < b; i += 2) {
      const d = segmentDistance(
        points[i],
        points[i + 1],
        points[a],
        points[a + 1],
        points[b],
        points[b + 1],
      );
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (idx !== -1) {
      keep.add(idx);
      stack.push([a, idx], [idx, b]);
    }
  }
  return [...keep]
    .sort((a, b) => a - b)
    .flatMap((i) => [
      Math.round(points[i] * 10) / 10,
      Math.round(points[i + 1] * 10) / 10,
    ]);
}
/** Shape anchor used for live connector routing. */
export function anchor(
  el: Element,
  side = "auto",
  toward?: { x: number; y: number },
) {
  const w = el.w || 0,
    h = el.h || 0,
    c = { x: el.x + w / 2, y: el.y + h / 2 };
  if (side === "auto" && toward) {
    const dx = toward.x - c.x,
      dy = toward.y - c.y;
    side =
      Math.abs(dx / w) > Math.abs(dy / h)
        ? dx > 0
          ? "right"
          : "left"
        : dy > 0
          ? "bottom"
          : "top";
  }
  return side === "left"
    ? { x: el.x, y: c.y }
    : side === "right"
      ? { x: el.x + w, y: c.y }
      : side === "top"
        ? { x: c.x, y: el.y }
        : side === "bottom"
          ? { x: c.x, y: el.y + h }
          : c;
}
/** Bound endpoints are derived, never patched when their target moves. */
export function connectorPoints(
  el: Element,
  elements: Record<string, Element>,
): number[] {
  const p = el.points || [el.x, el.y, el.x + (el.w || 100), el.y + (el.h || 0)];
  let a = { x: p[0], y: p[1] },
    b = { x: p[p.length - 2], y: p[p.length - 1] };
  if (el.start && elements[el.start.elId])
    a = anchor(elements[el.start.elId], el.start.anchor, b);
  if (el.end && elements[el.end.elId])
    b = anchor(elements[el.end.elId], el.end.anchor, a);
  if (el.route !== "elbow")
    return !el.start && !el.end && p.length > 4 ? p : [a.x, a.y, b.x, b.y];
  const obstacles = [el.start?.elId, el.end?.elId]
    .filter((id): id is string => !!id)
    .map((id) => elements[id])
    .filter(Boolean)
    .map((target) => ({
      minX: target.x,
      minY: target.y,
      maxX: target.x + (target.w || 0),
      maxY: target.y + (target.h || 0),
    }));
  const clear = (x1: number, y1: number, x2: number, y2: number) =>
    !obstacles.some((o) =>
      x1 === x2
        ? x1 > o.minX &&
          x1 < o.maxX &&
          Math.max(y1, y2) > o.minY &&
          Math.min(y1, y2) < o.maxY
        : y1 > o.minY &&
          y1 < o.maxY &&
          Math.max(x1, x2) > o.minX &&
          Math.min(x1, x2) < o.maxX,
    );
  const simple = [
    a.x,
    a.y,
    (a.x + b.x) / 2,
    a.y,
    (a.x + b.x) / 2,
    b.y,
    b.x,
    b.y,
  ];
  if (
    Array.from({ length: 3 }, (_, i) =>
      clear(
        simple[i * 2],
        simple[i * 2 + 1],
        simple[i * 2 + 2],
        simple[i * 2 + 3],
      ),
    ).every(Boolean)
  )
    return simple;
  // A tiny visibility grid routes around the two endpoint boxes, including backwards-facing anchors.
  const xs = [
      ...new Set([
        a.x,
        b.x,
        ...obstacles.flatMap((o) => [o.minX - 24, o.maxX + 24]),
      ]),
    ].sort((x, y) => x - y),
    ys = [
      ...new Set([
        a.y,
        b.y,
        ...obstacles.flatMap((o) => [o.minY - 24, o.maxY + 24]),
      ]),
    ].sort((x, y) => x - y);
  const points = xs.flatMap((x) => ys.map((y) => ({ x, y }))),
    start = points.findIndex((p) => p.x === a.x && p.y === a.y),
    end = points.findIndex((p) => p.x === b.x && p.y === b.y),
    distance = new Map([[start, 0]]),
    previous = new Map<number, number>(),
    open = new Set([start]);
  while (open.size) {
    const current = [...open].sort(
      (x, y) => distance.get(x)! - distance.get(y)!,
    )[0];
    open.delete(current);
    if (current === end) break;
    const from = points[current];
    for (let next = 0; next < points.length; next++) {
      const to = points[next];
      if (
        next === current ||
        (from.x !== to.x && from.y !== to.y) ||
        !clear(from.x, from.y, to.x, to.y)
      )
        continue;
      const score =
        distance.get(current)! +
        Math.abs(from.x - to.x) +
        Math.abs(from.y - to.y) +
        1;
      if (score < (distance.get(next) ?? Infinity)) {
        distance.set(next, score);
        previous.set(next, current);
        open.add(next);
      }
    }
  }
  if (!distance.has(end)) return simple;
  const route: number[] = [];
  let at: number | undefined = end;
  while (at !== undefined) {
    route.unshift(points[at].x, points[at].y);
    at = previous.get(at);
  }
  return route;
}
/** Center-based frame membership supports moving a frame with its contents. */
export function contains(frame: Element, el: Element) {
  const x = el.x + (el.w || 0) / 2,
    y = el.y + (el.h || 0) / 2;
  return (
    x >= frame.x &&
    x <= frame.x + (frame.w || 0) &&
    y >= frame.y &&
    y <= frame.y + (frame.h || 0)
  );
}
/** Deterministic horizontal tree layout with branch sides and collapsed descendants. */
export function layoutMindMap(
  nodes: Element[],
  rootId: string,
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  const root = nodes.find((n) => n.id === rootId);
  if (!root) return result;
  const children = (node: Element) =>
    node.collapsed
      ? []
      : nodes.filter((n) => n.parentId === node.id && n.id !== node.id);
  const spans = new Map<string, number>();
  const measure = (node: Element, path = new Set<string>()): number => {
    if (path.has(node.id)) return 0;
    const next = new Set(path).add(node.id),
      list = children(node).filter((n) => !next.has(n.id));
    const span = Math.max(
      node.h || 64,
      list.reduce((sum, n) => sum + measure(n, next), 0) +
        Math.max(0, list.length - 1) * 36,
    );
    spans.set(node.id, span);
    return span;
  };
  measure(root);
  const visited = new Set<string>([root.id]);
  result.set(root.id, { x: root.x, y: root.y });
  const place = (
    node: Element,
    parent: Element,
    parentX: number,
    top: number,
    side: number,
  ) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    const span = spans.get(node.id) || 64,
      x =
        side === 1
          ? parentX + (parent.w || 160) + 80
          : parentX - (node.w || 160) - 80,
      y = top + span / 2 - (node.h || 64) / 2;
    result.set(node.id, { x, y });
    const list = children(node).filter((n) => !visited.has(n.id)),
      total =
        list.reduce((sum, n) => sum + (spans.get(n.id) || 64), 0) +
        Math.max(0, list.length - 1) * 36;
    let cursor = y + (node.h || 64) / 2 - total / 2;
    for (const child of list) {
      place(child, node, x, cursor, side);
      cursor += (spans.get(child.id) || 64) + 36;
    }
  };
  for (const side of [-1, 1]) {
    const list = children(root).filter(
        (n) => (n.side === "left" ? -1 : 1) === side,
      ),
      total =
        list.reduce((sum, n) => sum + (spans.get(n.id) || 64), 0) +
        Math.max(0, list.length - 1) * 36;
    let top = root.y + (root.h || 64) / 2 - total / 2;
    for (const child of list) {
      place(child, root, root.x, top, side);
      top += (spans.get(child.id) || 64) + 36;
    }
  }
  return result;
}
