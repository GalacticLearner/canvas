/** Two-layer editor handles world-space gestures while all mutations remain shared operations. */
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import RBush from "rbush";
import { generateKeyBetween } from "fractional-indexing";
import {
  makeElement,
  bounds,
  hitTest,
  simplify,
  contains,
  layoutMindMap,
  snapMove,
  anchor,
  msg,
  can,
  isVisible,
  IDENTITY_COLORS,
  type Element,
  type Op,
} from "../../../shared/src/index";
import { useWorkspace, submit, send, undo, notify } from "../stores/workspace";
import { renderBoard, renderElement, type Viewport } from "./render";
import { boardBounds } from "../export/boardExport";
/** Tool identifiers share the element vocabulary wherever possible. */
export type Tool =
  | "select"
  | "hand"
  | "pen"
  | "highlighter"
  | "eraser"
  | "pixel"
  | "polyline"
  | Element["type"];
/** Canvas-level settings are selected in the surrounding properties bar. */
export interface CanvasProps {
  tool: Tool;
  color: string;
  fill: string | null;
  width: number;
  opacity: number;
  dash: Element["style"]["dash"];
  fontSize: number;
  route: "straight" | "elbow" | "curve";
  viewport: Viewport;
  setViewport: (v: Viewport) => void;
  selected: string[];
  setSelected: (ids: string[]) => void;
  minimap: boolean;
  authorship: boolean;
  follow: string | null;
  followPresenter: boolean;
  onTool: (tool: Tool) => void;
  onImage: () => void;
}
/** Pointer capture keeps a gesture alive outside the visible drawing region. */
export function BoardCanvas(props: CanvasProps) {
  const { board, you, presence, participants, settings, preview, present } =
    useWorkspace();
  const state = preview || board;
  const spatial = useMemo(() => {
    const tree = new RBush<any>();
    tree.load(
      Object.values(state.elements)
        .filter((el) => isVisible(el, state.elements))
        .map((el) => ({ ...bounds(el, state.elements), el })),
    );
    return tree;
  }, [state.elements]);
  const container = useRef<HTMLDivElement>(null),
    staticCanvas = useRef<HTMLCanvasElement>(null),
    overlay = useRef<HTMLCanvasElement>(null),
    mini = useRef<HTMLCanvasElement>(null);
  const current = useRef(props);
  const requestPaint = useRef<() => void>(() => {});
  current.current = props;
  const gesture = useRef<any>(null),
    polyline = useRef<Element | null>(null),
    hovered = useRef<Element | null>(null),
    keyboardPoint = useRef({ x: 300, y: 200 }),
    space = useRef(false),
    lastEph = useRef(new Map<string, number>()),
    clipboard = useRef<Element[]>([]);
  const [size, setSize] = useState({ w: 1000, h: 700 }),
    [editing, setEditing] = useState<{ el: Element; text: string } | null>(
      null,
    );
  const [tick, setTick] = useState(0);
  const [showHints, setShowHints] = useState(
    localStorage.getItem("canvas-hints-dismissed") !== "true",
  );
  const dark = document.documentElement.dataset.theme === "dark";
  const { viewport, selected } = props;
  const world = useCallback((x: number, y: number) => {
    const r = container.current!.getBoundingClientRect(),
      v = current.current.viewport;
    const scale =
      Number(
        getComputedStyle(document.documentElement).getPropertyValue("--scale"),
      ) || 1;
    return {
      x: ((x - r.left) / scale - v.x) / v.zoom,
      y: ((y - r.top) / scale - v.y) / v.zoom,
    };
  }, []);
  const eph = (k: any, d: any) => {
    const now = performance.now();
    if (now - (lastEph.current.get(k) || 0) > 33) {
      lastEph.current.set(k, now);
      send(msg("eph", { k, d }));
      return true;
    }
    return false;
  };
  const pick = (x: number, y: number, includeLocked = false) =>
    spatial
      .search({
        minX: x - 8 / viewport.zoom,
        minY: y - 8 / viewport.zoom,
        maxX: x + 8 / viewport.zoom,
        maxY: y + 8 / viewport.zoom,
      })
      .map((item) => item.el as Element)
      .sort((a, b) => b.z.localeCompare(a.z))
      .find(
        (el) =>
          (includeLocked || !el.locked) &&
          hitTest(el, x, y, 7 / viewport.zoom, state.elements),
      );
  const edit = useCallback(
    (el: Element) => {
      const lock = Object.values(useWorkspace.getState().presence).find(
        (p: any) =>
          p.k === "editing" &&
          p.d.id === el.id &&
          p.by !== you.id &&
          p.d.active &&
          Date.now() - p.time < 30000,
      );
      if (lock) {
        notify("Someone else is editing this element");
        return;
      }
      send(msg("eph", { k: "editing", d: { id: el.id, active: true } }));
      setEditing({ el, text: el.text || "" });
    },
    [you.id],
  );
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const timer = setInterval(
      () => eph("viewport", current.current.viewport),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!editing) return;
    const id = editing.el.id;
    const timer = setInterval(
      () => send(msg("eph", { k: "editing", d: { id, active: true } })),
      10000,
    );
    return () => {
      clearInterval(timer);
      send(msg("eph", { k: "editing", d: { id, active: false } }));
    };
  }, [editing?.el.id]);
  useEffect(() => {
    const redraw = () => setTick((n) => n + 1),
      observer = new MutationObserver(redraw);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    window.addEventListener("canvas:asset-ready", redraw);
    void document.fonts.ready.then(redraw);
    return () => {
      observer.disconnect();
      window.removeEventListener("canvas:asset-ready", redraw);
    };
  }, []);
  useEffect(() => {
    const followed = props.follow && presence[props.follow + ":viewport"];
    if (followed && Date.now() - followed.time < 5000)
      props.setViewport(followed.d);
  }, [presence, props.follow]);
  useEffect(() => {
    if (present.active && present.frameId && props.followPresenter) {
      const frame = board.elements[present.frameId];
      if (frame) {
        const zoom = Math.min(
          size.w / (frame.w! + 80),
          size.h / (frame.h! + 80),
        );
        const target = {
          zoom,
          x: size.w / 2 - (frame.x + frame.w! / 2) * zoom,
          y: size.h / 2 - (frame.y + frame.h! / 2) * zoom,
        };
        if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
          props.setViewport(target);
          return;
        }
        const from = current.current.viewport,
          started = performance.now();
        let animation: number;
        const step = (now: number) => {
          const t = Math.min(1, (now - started) / 180),
            ease = 1 - (1 - t) ** 3;
          props.setViewport({
            x: from.x + (target.x - from.x) * ease,
            y: from.y + (target.y - from.y) * ease,
            zoom: from.zoom + (target.zoom - from.zoom) * ease,
          });
          if (t < 1) animation = requestAnimationFrame(step);
        };
        animation = requestAnimationFrame(step);
        return () => cancelAnimationFrame(animation);
      }
    }
  }, [present.frameId, present.active, size.w, size.h, props.followPresenter]);
  useEffect(() => {
    const canvas = staticCanvas.current!;
    const dpr = devicePixelRatio || 1;
    if (
      canvas.width !== Math.round(size.w * dpr) ||
      canvas.height !== Math.round(size.h * dpr)
    ) {
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
    }
    const c = canvas.getContext("2d")!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, size.w, size.h);
    c.translate(viewport.x, viewport.y);
    c.scale(viewport.zoom, viewport.zoom);
    const visible = spatial
      .search({
        minX: -viewport.x / viewport.zoom - 100,
        minY: -viewport.y / viewport.zoom - 100,
        maxX: (size.w - viewport.x) / viewport.zoom + 100,
        maxY: (size.h - viewport.y) / viewport.zoom + 100,
      })
      .map((item) => item.el);
    renderBoard(c, state, visible, dark);
    if (mini.current && props.minimap) {
      const m = mini.current.getContext("2d")!;
      m.clearRect(0, 0, 180, 110);
      m.save();
      const region = boardBounds(state),
        miniScale = Math.min(180 / region.w, 110 / region.h);
      m.scale(miniScale, miniScale);
      m.translate(-region.x, -region.y);
      renderBoard(m, state, undefined, dark);
      m.strokeStyle = "#B06C17";
      m.lineWidth = 1 / miniScale;
      m.strokeRect(
        -viewport.x / viewport.zoom,
        -viewport.y / viewport.zoom,
        size.w / viewport.zoom,
        size.h / viewport.zoom,
      );
      m.restore();
    }
  }, [state, viewport, size, props.minimap, tick, dark]);
  useEffect(() => {
    let frame: number;
    const draw = () => {
      const canvas = overlay.current!;
      const dpr = devicePixelRatio || 1;
      if (canvas.width !== size.w * dpr || canvas.height !== size.h * dpr) {
        canvas.width = size.w * dpr;
        canvas.height = size.h * dpr;
      }
      const c = canvas.getContext("2d")!;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, size.w, size.h);
      c.translate(viewport.x, viewport.y);
      c.scale(viewport.zoom, viewport.zoom);
      const g = gesture.current;
      if (hovered.current) {
        const el = hovered.current,
          b = bounds(el, state.elements);
        c.strokeStyle = props.authorship
          ? participants.find((p) => p.id === el.authorId)?.color || "#B07816"
          : "#B04738";
        c.lineWidth = 2 / viewport.zoom;
        c.strokeRect(
          b.minX - 3,
          b.minY - 3,
          b.maxX - b.minX + 6,
          b.maxY - b.minY + 6,
        );
      }
      if (g?.el) renderElement(c, g.el, state.elements, dark);
      if (g?.moving)
        for (const el of g.moving) renderElement(c, el, state.elements, dark);
      for (const id of selected) {
        const el = state.elements[id];
        if (!el) continue;
        const b = bounds(el);
        c.strokeStyle = "#AB741B";
        c.lineWidth = 1.5 / viewport.zoom;
        c.setLineDash([5 / viewport.zoom, 3 / viewport.zoom]);
        c.strokeRect(
          b.minX - 4,
          b.minY - 4,
          b.maxX - b.minX + 8,
          b.maxY - b.minY + 8,
        );
        c.setLineDash([]);
        for (const [x, y] of [
          [b.minX, b.minY],
          [b.maxX, b.minY],
          [b.maxX, b.maxY],
          [b.minX, b.maxY],
        ]) {
          c.fillStyle = "#fff";
          c.fillRect(
            x - 4 / viewport.zoom,
            y - 4 / viewport.zoom,
            8 / viewport.zoom,
            8 / viewport.zoom,
          );
          c.strokeRect(
            x - 4 / viewport.zoom,
            y - 4 / viewport.zoom,
            8 / viewport.zoom,
            8 / viewport.zoom,
          );
        }
        if (!el.locked && !el.points && el.type !== "frame") {
          for (const side of ["top", "right", "bottom", "left"]) {
            const p = anchor(el, side);
            c.beginPath();
            c.arc(p.x, p.y, 5 / viewport.zoom, 0, Math.PI * 2);
            c.fillStyle = "#AB741B";
            c.fill();
          }
        }
      }
      if (g?.marquee) {
        c.strokeStyle = "#AB741B";
        c.lineWidth = 1 / viewport.zoom;
        c.strokeRect(
          g.start.x,
          g.start.y,
          g.last.x - g.start.x,
          g.last.y - g.start.y,
        );
      }
      if (g?.guides) {
        c.strokeStyle = "#B07816";
        c.lineWidth = 1 / viewport.zoom;
        for (const guide of g.guides) {
          c.beginPath();
          if (guide.axis === "x") {
            c.moveTo(guide.value, -viewport.y / viewport.zoom);
            c.lineTo(guide.value, (size.h - viewport.y) / viewport.zoom);
          } else {
            c.moveTo(-viewport.x / viewport.zoom, guide.value);
            c.lineTo((size.w - viewport.x) / viewport.zoom, guide.value);
          }
          c.stroke();
        }
      }
      for (const p of Object.values(presence) as any[]) {
        if (
          p.by === you.id ||
          Date.now() - p.time > (p.k === "editing" ? 30000 : 5000)
        )
          continue;
        const person = participants.find((v) => v.id === p.by);
        if (p.k === "editing" && p.d.active && state.elements[p.d.id]) {
          const el = state.elements[p.d.id];
          c.fillStyle = person?.color || "#0072B2";
          c.font = `${12 / viewport.zoom}px sans-serif`;
          c.fillText(
            `${person?.username || "Participant"} is editing`,
            el.x,
            el.y - 10 / viewport.zoom,
          );
        }
        if (p.k === "cursor" || p.k === "laser") {
          c.fillStyle = person?.color || "#0072B2";
          c.beginPath();
          if (p.k === "laser") c.arc(p.d.x, p.d.y, 6, 0, Math.PI * 2);
          else {
            c.moveTo(p.d.x, p.d.y);
            c.lineTo(p.d.x + 12 / viewport.zoom, p.d.y + 8 / viewport.zoom);
            c.lineTo(p.d.x + 5 / viewport.zoom, p.d.y + 11 / viewport.zoom);
            c.closePath();
          }
          c.fill();
          c.font = `${12 / viewport.zoom}px "Public Sans Variable",sans-serif`;
          c.fillText(
            person?.username || "Participant",
            p.d.x + 8 / viewport.zoom,
            p.d.y + 16 / viewport.zoom,
          );
        }
        if (p.k === "stroke_preview" && p.d.el)
          try {
            renderElement(c, p.d.el, state.elements, dark);
          } catch {
            /* Expired or incomplete previews never affect committed state. */
          }
        if (p.k === "shape_preview" && p.d.el)
          try {
            renderElement(c, p.d.el, state.elements, dark);
          } catch {
            /* Preview validation never changes board truth. */
          }
        if (p.k === "drag_preview" && Array.isArray(p.d.elements))
          for (const el of p.d.elements.slice(0, 500))
            try {
              renderElement(c, el, state.elements, dark);
            } catch {
              /* Ignore an incomplete remote preview. */
            }
      }
      frame = 0;
      if (
        gesture.current ||
        Object.values(presence).some(
          (p: any) => Date.now() - p.time < (p.k === "editing" ? 30000 : 5000),
        )
      )
        frame = requestAnimationFrame(draw);
    };
    frame = 0;
    requestPaint.current = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    requestPaint.current();
    return () => {
      cancelAnimationFrame(frame);
      requestPaint.current = () => {};
    };
  }, [state, viewport, size, selected, presence, participants, you.id, dark]);
  const create = (x: number, y: number): Element => {
    const tool = props.tool;
    const type =
      tool === "pen" || tool === "highlighter"
        ? "stroke"
        : tool === "pixel"
          ? "erase"
          : tool === "polyline"
            ? "line"
            : (tool as Element["type"]);
    const el = makeElement(type, crypto.randomUUID(), x, y);
    const sorted = Object.values(board.elements)
      .map((e) => e.z)
      .sort();
    el.z = generateKeyBetween(sorted.at(-1) || null, null);
    el.style = {
      ...el.style,
      stroke: props.color,
      fill: props.fill,
      strokeWidth: props.width,
      opacity: props.opacity,
      dash: props.dash,
      fontSize: props.fontSize,
    };
    el.fontSize = props.fontSize;
    if (type === "stroke" || type === "erase") {
      el.points = [x, y];
      el.tool = tool === "highlighter" ? "highlighter" : "pen";
      el.size = props.width * 4;
    }
    if (type === "arrow" || type === "line") {
      el.points = [x, y, x, y];
      el.route = props.route;
      const target = pick(x, y);
      if (target) el.start = { elId: target.id, anchor: "auto" };
    }
    if (type === "sticky") {
      el.w = 210;
      el.h = 160;
      el.text = "";
      el.color = "#F3D98B";
    }
    if (type === "mindnode") {
      el.w = 170;
      el.h = 64;
      el.text = "New idea";
      el.parentId = null;
      el.side = "right";
      el.style.fill = "#E0E9DB";
    }
    if (type === "frame") {
      el.w = 640;
      el.h = 360;
      el.title = "Frame " + (board.frames.length + 1);
    }
    return el;
  };
  const down = (event: React.PointerEvent<HTMLCanvasElement>) => {
    requestPaint.current();
    if (editing) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = world(event.clientX, event.clientY),
      g: any = {
        start: p,
        last: p,
        client: { x: event.clientX, y: event.clientY },
        originalViewport: { ...viewport },
      };
    if (event.button === 1 || space.current || props.tool === "hand") {
      g.pan = true;
      gesture.current = g;
      return;
    }
    if (!can(you.role, "draw", settings) || preview) {
      notify("This board is read-only for your role");
      return;
    }
    if (props.tool === "polyline") {
      if (!polyline.current) {
        polyline.current = create(p.x, p.y);
        polyline.current.points = [p.x, p.y, p.x, p.y];
      } else polyline.current.points!.push(p.x, p.y);
      g.el = polyline.current;
      g.polyline = true;
      gesture.current = g;
      return;
    }
    if (props.tool === "select") {
      for (const id of selected) {
        const el = state.elements[id];
        if (!el || el.locked) continue;
        const b = bounds(el),
          corners = [
            [b.minX, b.minY],
            [b.maxX, b.minY],
            [b.maxX, b.maxY],
            [b.minX, b.maxY],
          ];
        const corner = corners.findIndex(
          ([x, y]) => Math.hypot(p.x - x, p.y - y) < 10 / viewport.zoom,
        );
        if (corner >= 0) {
          g.originals = [el];
          g.resize = true;
          g.corner = corner;
          gesture.current = g;
          return;
        }
      }
      for (const id of selected) {
        const el = state.elements[id];
        if (!el || el.locked || el.points || el.type === "frame") continue;
        for (const side of ["top", "right", "bottom", "left"] as const) {
          const a = anchor(el, side);
          if (Math.hypot(p.x - a.x, p.y - a.y) < 9 / viewport.zoom) {
            g.el = create(p.x, p.y);
            g.el.type = "arrow";
            g.el.points = [a.x, a.y, p.x, p.y];
            g.el.start = { elId: id, anchor: side };
            g.el.route = props.route;
            g.connectFrom = el;
            gesture.current = g;
            return;
          }
        }
      }
      const target = pick(p.x, p.y, true);
      if (target) {
        let ids = event.shiftKey
          ? [...new Set([...selected, target.id])]
          : selected.includes(target.id)
            ? selected
            : [target.id];
        if (target.groupId)
          ids = Object.values(state.elements)
            .filter((e) => e.groupId === target.groupId)
            .map((e) => e.id);
        props.setSelected(ids);
        const subtree = new Set(ids);
        let added = true;
        while (added) {
          added = false;
          for (const el of Object.values(state.elements))
            if (
              el.type === "mindnode" &&
              el.parentId &&
              subtree.has(el.parentId) &&
              !subtree.has(el.id)
            ) {
              subtree.add(el.id);
              added = true;
            }
        }
        g.originals = [...subtree]
          .map((id) => state.elements[id])
          .filter((el) => !el.locked);
        const b = bounds(target);
        g.resize = Math.hypot(p.x - b.maxX, p.y - b.maxY) < 14 / viewport.zoom;
      } else {
        props.setSelected([]);
        g.marquee = true;
      }
      gesture.current = g;
      return;
    }
    if (props.tool === "eraser") {
      g.erased = new Set<string>();
      const target = pick(p.x, p.y);
      if (target) g.erased.add(target.id);
    } else if (props.tool === "image") {
      props.onImage();
      return;
    } else {
      g.el = create(p.x, p.y);
    }
    gesture.current = g;
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    requestPaint.current();
    const p = world(event.clientX, event.clientY);
    eph(
      present.active && present.presenterId === you.id ? "laser" : "cursor",
      p,
    );
    hovered.current =
      props.authorship || props.tool === "eraser"
        ? pick(p.x, p.y, true) || null
        : null;
    event.currentTarget.title =
      props.authorship && hovered.current
        ? `Drawn by ${hovered.current.authorName}`
        : "";
    const g = gesture.current;
    if (!g) return;
    g.last = p;
    if (g.pan) {
      props.setViewport({
        ...viewport,
        x: g.originalViewport.x + (event.clientX - g.client.x),
        y: g.originalViewport.y + (event.clientY - g.client.y),
      });
      eph("viewport", current.current.viewport);
      return;
    }
    if (g.erased) {
      const target = pick(p.x, p.y);
      if (target) g.erased.add(target.id);
      return;
    }
    if (g.originals) {
      const snapped = snapMove(
        g.originals,
        Object.values(state.elements).filter(
          (el) => !g.originals.some((o: Element) => o.id === el.id),
        ),
        p.x - g.start.x,
        p.y - g.start.y,
        5 / viewport.zoom,
      );
      const dx = event.altKey ? p.x - g.start.x : snapped.dx,
        dy = event.altKey ? p.y - g.start.y : snapped.dy;
      g.guides = event.altKey ? [] : snapped.guides;
      g.moving = g.originals.map((el: Element) => {
        if (g.resize) {
          const left = g.corner === 0 || g.corner === 3,
            top = g.corner === 0 || g.corner === 1;
          const w = Math.max(20, (el.w || 160) + (left ? -dx : dx)),
            h = Math.max(
              20,
              event.shiftKey
                ? (w * (el.h || 100)) / (el.w || 160)
                : (el.h || 100) + (top ? -dy : dy),
            );
          const x = left ? el.x + (el.w || 160) - w : el.x,
            y = top ? el.y + (el.h || 100) - h : el.y;
          return {
            ...el,
            x,
            y,
            w,
            h,
            points: el.points?.map((n, i) =>
              i % 2
                ? y + ((n - el.y) * h) / (el.h || 100)
                : x + ((n - el.x) * w) / (el.w || 160),
            ),
          };
        }
        return {
          ...el,
          x: el.x + dx,
          y: el.y + dy,
          points: el.points?.map((n, i) => n + (i % 2 ? dy : dx)),
        };
      });
      eph("drag_preview", { elements: g.moving });
      return;
    }
    if (g.el) {
      const el = g.el as Element;
      if (g.polyline) {
        el.points![el.points!.length - 2] = p.x;
        el.points![el.points!.length - 1] = p.y;
        return;
      }
      if (["text", "sticky", "mindnode"].includes(el.type)) return;
      if (el.type === "stroke" || el.type === "erase") {
        const events = event.nativeEvent.getCoalescedEvents?.() || [
          event.nativeEvent,
        ];
        if (!events.length) events.push(event.nativeEvent);
        for (const e of events) {
          const q = world(e.clientX, e.clientY);
          if (el.points!.length < 40000) el.points!.push(q.x, q.y);
        }
        const tail = el.points!.slice(g.previewIndex || 0),
          stride = Math.max(1, Math.ceil(tail.length / 128)) * 2,
          points: number[] = [];
        for (let i = 0; i < tail.length; i += stride)
          points.push(
            Math.round(tail[i] * 10) / 10,
            Math.round(tail[i + 1] * 10) / 10,
          );
        if (tail.length >= 2 && points.at(-2) !== tail.at(-2))
          points.push(
            Math.round(tail.at(-2)! * 10) / 10,
            Math.round(tail.at(-1)! * 10) / 10,
          );
        if (
          eph("stroke_preview", {
            el: { ...el, points },
            append: true,
            serial: g.previewSerial || 0,
          })
        ) {
          g.previewIndex = Math.max(0, el.points!.length - 2);
          g.previewSerial = (g.previewSerial || 0) + 1;
        }
      } else if (el.type === "line" || el.type === "arrow") {
        let x = p.x,
          y = p.y;
        if (event.shiftKey) {
          const angle =
              (Math.round(
                Math.atan2(y - g.start.y, x - g.start.x) / (Math.PI / 4),
              ) *
                Math.PI) /
              4,
            len = Math.hypot(x - g.start.x, y - g.start.y);
          x = g.start.x + Math.cos(angle) * len;
          y = g.start.y + Math.sin(angle) * len;
        }
        el.points = [g.start.x, g.start.y, x, y];
        const target = pick(p.x, p.y);
        el.end =
          target && target.id !== el.start?.elId
            ? { elId: target.id, anchor: "auto" }
            : undefined;
      } else {
        el.x = Math.min(p.x, g.start.x);
        el.y = Math.min(p.y, g.start.y);
        el.w = Math.max(2, Math.abs(p.x - g.start.x));
        el.h = Math.max(2, event.shiftKey ? el.w : Math.abs(p.y - g.start.y));
      }
      if (el.type !== "stroke" && el.type !== "erase")
        eph("shape_preview", { el });
    }
  };
  const up = () => {
    requestPaint.current();
    const g = gesture.current;
    if (g?.polyline) return;
    gesture.current = null;
    if (!g) return;
    if (g.el) {
      if (g.el.points && (g.el.type === "stroke" || g.el.type === "erase"))
        g.el.points = simplify(g.el.points, 0.6 / viewport.zoom);
      if (
        g.el.points?.length &&
        (g.el.type === "stroke" || g.el.type === "erase")
      ) {
        const xs = g.el.points.filter((_n: number, i: number) => i % 2 === 0),
          ys = g.el.points.filter((_n: number, i: number) => i % 2 === 1);
        g.el.x = Math.min(...xs);
        g.el.y = Math.min(...ys);
        g.el.w = Math.max(...xs) - g.el.x || 1;
        g.el.h = Math.max(...ys) - g.el.y || 1;
      }
      if (g.connectFrom && !g.el.end) {
        const node = makeElement(
          g.connectFrom.type,
          crypto.randomUUID(),
          g.last.x,
          g.last.y,
        );
        node.w = g.connectFrom.w || 160;
        node.h = g.connectFrom.h || 100;
        node.style = { ...g.connectFrom.style };
        node.z = generateKeyBetween(g.el.z, null);
        g.el.end = { elId: node.id, anchor: "auto" };
        submit({
          kind: "batch",
          ops: [
            { kind: "add", el: node },
            { kind: "add", el: g.el },
          ],
        });
        props.setSelected([node.id]);
      } else submit({ kind: "add", el: g.el });
      if (["text", "sticky", "mindnode"].includes(g.el.type))
        requestAnimationFrame(() => edit(g.el));
    }
    if (g.erased?.size) submit({ kind: "remove", ids: [...g.erased] });
    if (g.moving) {
      const ops: Op[] = g.moving.map((el: Element) => ({
        kind: "patch",
        id: el.id,
        set: g.resize
          ? {
              x: el.x,
              y: el.y,
              w: el.w,
              h: el.h,
              ...(el.points ? { points: el.points } : {}),
            }
          : { x: el.x, y: el.y, ...(el.points ? { points: el.points } : {}) },
      }));
      for (let i = 0; i < g.originals.length; i++) {
        const el = g.originals[i] as Element;
        if (el.type === "frame") {
          const dx = g.moving[i].x - el.x,
            dy = g.moving[i].y - el.y;
          for (const child of Object.values(state.elements))
            if (
              child.id !== el.id &&
              !selected.includes(child.id) &&
              contains(el, child)
            )
              ops.push({
                kind: "patch",
                id: child.id,
                set: {
                  x: child.x + dx,
                  y: child.y + dy,
                  ...(child.points
                    ? {
                        points: child.points.map(
                          (n, j) => n + (j % 2 ? dy : dx),
                        ),
                      }
                    : {}),
                },
              });
        }
      }
      submit({ kind: "batch", ops });
    }
    if (g.marquee) {
      const minX = Math.min(g.start.x, g.last.x),
        maxX = Math.max(g.start.x, g.last.x),
        minY = Math.min(g.start.y, g.last.y),
        maxY = Math.max(g.start.y, g.last.y);
      props.setSelected(
        Object.values(state.elements)
          .filter((el) => {
            const b = bounds(el);
            return (
              b.minX >= minX &&
              b.maxX <= maxX &&
              b.minY >= minY &&
              b.maxY <= maxY
            );
          })
          .map((el) => el.id),
      );
    }
  };
  useEffect(() => {
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const v = current.current.viewport;
      if (event.ctrlKey || event.metaKey || !event.shiftKey) {
        const rect = container.current!.getBoundingClientRect(),
          sx = event.clientX - rect.left,
          sy = event.clientY - rect.top,
          z = Math.max(
            0.1,
            Math.min(8, v.zoom * Math.exp(-event.deltaY * 0.0015)),
          );
        current.current.setViewport({
          zoom: z,
          x: sx - ((sx - v.x) * z) / v.zoom,
          y: sy - ((sy - v.y) * z) / v.zoom,
        });
      } else
        current.current.setViewport({
          ...v,
          x: v.x - event.deltaX,
          y: v.y - event.deltaY,
        });
    };
    const el = container.current!;
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (useWorkspace.getState().present.active) return;
      if (
        (event.target as HTMLElement).matches("input,textarea,select") ||
        editing
      )
        return;
      const ids = current.current.selected;
      const items = ids
        .map((id) => useWorkspace.getState().board.elements[id])
        .filter(Boolean);
      const target = event.target as HTMLElement;
      if (target.closest('[role="dialog"],dialog[open]')) return;
      const canvasFocused =
        target === overlay.current || target === document.body;
      if (!canvasFocused && !event.ctrlKey && !event.metaKey) return;
      if (event.key === "Escape") {
        props.setSelected([]);
        polyline.current = null;
        gesture.current = null;
        return;
      }
      if (event.code === "Space" && items[0]?.type === "mindnode") {
        event.preventDefault();
        submit({
          kind: "patch",
          id: items[0].id,
          set: { collapsed: !items[0].collapsed },
        });
        return;
      }
      if (
        polyline.current &&
        (event.key === "Enter" || event.key === "Escape")
      ) {
        event.preventDefault();
        if (event.key === "Enter")
          submit({ kind: "add", el: polyline.current });
        polyline.current = null;
        gesture.current = null;
        return;
      }
      if (event.target === overlay.current && !items.length) {
        const point = keyboardPoint.current;
        if (event.key.startsWith("Arrow")) {
          event.preventDefault();
          point.x +=
            event.key === "ArrowRight"
              ? 10
              : event.key === "ArrowLeft"
                ? -10
                : 0;
          point.y +=
            event.key === "ArrowDown" ? 10 : event.key === "ArrowUp" ? -10 : 0;
          return;
        }
        if (
          event.key === "Enter" &&
          can(you.role, "draw", settings) &&
          !["select", "hand", "eraser", "image"].includes(current.current.tool)
        ) {
          event.preventDefault();
          const el = create(point.x, point.y);
          if (
            el.type === "stroke" ||
            el.type === "erase" ||
            el.type === "line" ||
            el.type === "arrow"
          )
            el.points = [point.x, point.y, point.x + 100, point.y + 40];
          submit({ kind: "add", el });
          if (["text", "sticky", "mindnode"].includes(el.type)) edit(el);
          return;
        }
      }
      if (event.code === "Space") {
        event.preventDefault();
        space.current = true;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        const subtree = new Set(ids);
        let changed = true;
        while (changed) {
          changed = false;
          for (const el of Object.values(board.elements))
            if (
              el.parentId &&
              subtree.has(el.parentId) &&
              !subtree.has(el.id)
            ) {
              subtree.add(el.id);
              changed = true;
            }
        }
        submit({ kind: "remove", ids: [...subtree] });
        props.setSelected([]);
      }
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo(event.shiftKey);
      }
      if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        undo(true);
      }
      if (mod && event.key.toLowerCase() === "c") {
        event.preventDefault();
        clipboard.current = structuredClone(items);
      }
      if (mod && ["v", "d"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        const source =
          event.key.toLowerCase() === "d" ? items : clipboard.current;
        const mapping = new Map(
          source.map((el) => [el.id, crypto.randomUUID()]),
        );
        const groups = new Map(
          source
            .filter((el) => el.groupId)
            .map((el) => [el.groupId!, crypto.randomUUID()]),
        );
        let z =
          Object.values(board.elements)
            .map((e) => e.z)
            .sort()
            .at(-1) || null;
        const ops: Op[] = source.map((el) => {
          z = generateKeyBetween(z, null);
          return {
            kind: "add",
            el: {
              ...el,
              id: mapping.get(el.id)!,
              groupId: el.groupId ? groups.get(el.groupId) : el.groupId,
              frameId: el.frameId
                ? mapping.get(el.frameId) || null
                : el.frameId,
              x: el.x + 24,
              y: el.y + 24,
              z,
              points: el.points?.map((n) => n + 24),
              parentId: el.parentId
                ? mapping.get(el.parentId) || null
                : el.parentId,
              start: el.start
                ? {
                    ...el.start,
                    elId: mapping.get(el.start.elId) || el.start.elId,
                  }
                : undefined,
              end: el.end
                ? { ...el.end, elId: mapping.get(el.end.elId) || el.end.elId }
                : undefined,
            },
          };
        });
        submit({ kind: "batch", ops });
        props.setSelected([...mapping.values()]);
      }
      if (mod && event.key === "g") {
        event.preventDefault();
        const groupId = event.shiftKey ? null : crypto.randomUUID();
        submit({
          kind: "batch",
          ops: items.map((el) => ({
            kind: "patch",
            id: el.id,
            set: { groupId },
          })),
        });
      }
      if (
        !mod &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
          event.key,
        ) &&
        items.length
      ) {
        event.preventDefault();
        const dx =
            (event.key === "ArrowLeft"
              ? -1
              : event.key === "ArrowRight"
                ? 1
                : 0) * (event.shiftKey ? 10 : 1),
          dy =
            (event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0) *
            (event.shiftKey ? 10 : 1);
        submit({
          kind: "batch",
          ops: items.map((el) => ({
            kind: "patch",
            id: el.id,
            set: {
              x: el.x + dx,
              y: el.y + dy,
              ...(el.points
                ? { points: el.points.map((n, i) => n + (i % 2 ? dy : dx)) }
                : {}),
            },
          })),
        });
      }
      if (
        items[0]?.type === "mindnode" &&
        (event.key === "Tab" || event.key === "Enter")
      ) {
        event.preventDefault();
        const parent =
            event.key === "Tab"
              ? items[0]
              : board.elements[items[0].parentId || ""] || items[0],
          el = makeElement(
            "mindnode",
            crypto.randomUUID(),
            parent.x + 240,
            parent.y + 100,
          );
        el.parentId = parent.id;
        el.side = parent.parentId
          ? parent.side || "right"
          : event.shiftKey
            ? "left"
            : Object.values(board.elements).filter(
                  (n) => n.parentId === parent.id,
                ).length % 2
              ? "left"
              : "right";
        el.style = {
          ...parent.style,
          stroke: parent.parentId
            ? parent.style.stroke
            : IDENTITY_COLORS[
                Object.values(board.elements).filter(
                  (n) => n.parentId === parent.id,
                ).length % IDENTITY_COLORS.length
              ],
        };
        el.w = 170;
        el.h = 64;
        el.text = "New idea";
        el.z = generateKeyBetween(
          Object.values(board.elements)
            .map((e) => e.z)
            .sort()
            .at(-1) || null,
          null,
        );
        let root = parent;
        const visited = new Set<string>();
        while (
          root.parentId &&
          board.elements[root.parentId] &&
          !visited.has(root.id)
        ) {
          visited.add(root.id);
          root = board.elements[root.parentId];
        }
        const nodes = [...Object.values(board.elements), el],
          positions = layoutMindMap(nodes, root.id);
        submit({
          kind: "batch",
          ops: [
            { kind: "add", el },
            ...[...positions].map(([id, p]) => ({
              kind: "patch" as const,
              id,
              set: p,
            })),
          ],
        });
        props.setSelected([el.id]);
        edit(el);
      }
    };
    const release = (e: KeyboardEvent) => {
      if (e.code === "Space") space.current = false;
    };
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", release);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", release);
    };
  }, [board, editing, props]);
  const finishText = () => {
    if (!editing) return;
    const el = board.elements[editing.el.id];
    if (el)
      submit({
        kind: "patch",
        id: el.id,
        set: {
          text: editing.text,
          ...(el.type === "sticky"
            ? {
                h: Math.max(
                  el.h || 160,
                  editing.text.split("\n").length * props.fontSize * 1.35 + 40,
                  ((
                    document.querySelector(
                      ".text-editor",
                    ) as HTMLTextAreaElement
                  )?.scrollHeight || 0) / viewport.zoom,
                ),
              }
            : {}),
        },
      });
    send(msg("eph", { k: "editing", d: { id: editing.el.id, active: false } }));
    setEditing(null);
  };
  return (
    <div
      ref={container}
      className="board-stage grid"
      style={{
        backgroundSize: `${24 * viewport.zoom}px ${24 * viewport.zoom}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
      }}
    >
      <canvas ref={staticCanvas} className="canvas-layer" />
      <canvas
        ref={overlay}
        className="canvas-layer"
        tabIndex={0}
        aria-label="Shared whiteboard. Choose a tool to draw."
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={(e) => {
          if (polyline.current) {
            submit({ kind: "add", el: polyline.current });
            polyline.current = null;
            gesture.current = null;
            return;
          }
          const p = world(e.clientX, e.clientY),
            el = pick(p.x, p.y);
          if (el && can(you.role, "draw", settings)) edit(el);
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      {!Object.keys(state.elements).length && showHints && (
        <div className="empty-hint">
          <h2>A little space for a big idea.</h2>
          <p>Choose a tool and make your first mark.</p>
          <small>Hold Space to pan · Scroll to zoom · ? for shortcuts</small>
          <button
            style={{ pointerEvents: "auto", justifySelf: "center" }}
            onClick={() => {
              localStorage.setItem("canvas-hints-dismissed", "true");
              setShowHints(false);
            }}
          >
            Dismiss tips
          </button>
        </div>
      )}
      {editing && (
        <textarea
          className="text-editor"
          aria-label="Edit element text"
          autoFocus
          value={editing.text}
          style={{
            left: editing.el.x * viewport.zoom + viewport.x,
            top: editing.el.y * viewport.zoom + viewport.y,
            width: (editing.el.w || 240) * viewport.zoom,
            height: (editing.el.h || 100) * viewport.zoom,
            fontSize:
              (editing.el.fontSize ||
                editing.el.style.fontSize ||
                props.fontSize) * viewport.zoom,
          }}
          onChange={(e) => setEditing({ ...editing, text: e.target.value })}
          onBlur={finishText}
          onKeyDown={(e) => {
            if (e.key === "Escape" || (e.ctrlKey && e.key === "Enter")) {
              e.preventDefault();
              finishText();
            }
          }}
        />
      )}{" "}
      {props.minimap && (
        <canvas
          className="minimap"
          width={180}
          height={110}
          ref={mini}
          aria-label="Board minimap"
        />
      )}
      {props.authorship && (
        <div className="statusbar">
          <span>
            Authorship:{" "}
            {selected
              .map((id) => state.elements[id]?.authorName)
              .filter(Boolean)
              .join(", ") || "Select an element to see its author"}
          </span>
        </div>
      )}
    </div>
  );
}
