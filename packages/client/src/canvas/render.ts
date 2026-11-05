/** Shared Canvas2D rendering serves the viewport, version thumbnails and raster exports. */
import {
  connectorPoints,
  type Element,
  type BoardState,
} from "../../../shared/src/index";
/** Viewport converts world coordinates into CSS pixels; DPR is handled by the caller. */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}
/** Image objects are cached by verified content hash, never remote URL. */
export const images = new Map<string, HTMLImageElement>();
const paths = new WeakMap<Element, Path2D>();
/** Lift dark authored ink in dark viewports; files keep the original authored palette. */
export function viewportInk(color: string, dark: boolean) {
  if (!dark || !/^#[0-9a-f]{6}$/i.test(color)) return color;
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  if (
    rgb.reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0) / 255 >=
    0.6
  )
    return color;
  return (
    "#" +
    rgb
      .map((n) =>
        Math.round(n + (255 - n) * 0.65)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
/** Draw a single element without mutating its model. */
export function renderElement(
  c: CanvasRenderingContext2D,
  el: Element,
  elements: Record<string, Element>,
  dark = false,
) {
  c.save();
  const style = el.style;
  c.globalAlpha = style.opacity;
  const ink = viewportInk(style.stroke, dark);
  c.strokeStyle = ink;
  c.fillStyle = style.fill || "transparent";
  c.lineWidth = style.strokeWidth;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.setLineDash(
    style.dash === "dashed" ? [10, 7] : style.dash === "dotted" ? [1, 6] : [],
  );
  const x = el.x,
    y = el.y,
    w = el.w || 0,
    h = el.h || 0;
  if (el.angle) {
    c.translate(x + w / 2, y + h / 2);
    c.rotate(el.angle);
    c.translate(-x - w / 2, -y - h / 2);
  }
  if (el.type === "stroke" || el.type === "erase") {
    if (el.type === "erase") {
      c.globalCompositeOperation = "destination-out";
      c.lineWidth = el.size || 20;
    }
    if (el.tool === "highlighter") {
      c.globalAlpha = style.opacity * 0.35;
      c.lineWidth = style.strokeWidth * 3;
    }
    let path = el.ver > 0 ? paths.get(el) : undefined;
    if (!path) {
      path = new Path2D();
      const p = el.points || [];
      if (p.length) {
        path.moveTo(p[0], p[1]);
        for (let i = 2; i < p.length - 2; i += 2)
          path.quadraticCurveTo(
            p[i],
            p[i + 1],
            (p[i] + p[i + 2]) / 2,
            (p[i + 1] + p[i + 3]) / 2,
          );
        if (p.length >= 4) path.lineTo(p[p.length - 2], p[p.length - 1]);
        else path.lineTo(p[0] + 0.1, p[1]);
      }
      if (el.ver > 0) paths.set(el, path);
    }
    c.stroke(path);
  } else if (el.type === "line" || el.type === "arrow") {
    const p = connectorPoints(el, elements);
    c.beginPath();
    c.moveTo(p[0], p[1]);
    if (el.route === "curve") {
      const end = p.length - 2;
      c.bezierCurveTo(
        (p[0] + p[end]) / 2,
        p[1],
        (p[0] + p[end]) / 2,
        p[end + 1],
        p[end],
        p[end + 1],
      );
    } else for (let i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]);
    c.stroke();
    const head = (
      ax: number,
      ay: number,
      bx: number,
      by: number,
      kind: string,
    ) => {
      if (kind === "none") return;
      const angle = Math.atan2(by - ay, bx - ax),
        size = 12 + style.strokeWidth;
      c.beginPath();
      if (kind === "dot") {
        c.arc(bx, by, size / 3, 0, Math.PI * 2);
        c.fillStyle = ink;
        c.fill();
      } else if (kind === "diamond") {
        c.moveTo(bx, by);
        c.lineTo(
          bx - size * Math.cos(angle - 0.45),
          by - size * Math.sin(angle - 0.45),
        );
        c.lineTo(
          bx - 2 * size * Math.cos(angle),
          by - 2 * size * Math.sin(angle),
        );
        c.lineTo(
          bx - size * Math.cos(angle + 0.45),
          by - size * Math.sin(angle + 0.45),
        );
        c.closePath();
        c.fillStyle = ink;
        c.fill();
      } else {
        c.moveTo(
          bx - size * Math.cos(angle - 0.45),
          by - size * Math.sin(angle - 0.45),
        );
        c.lineTo(bx, by);
        c.lineTo(
          bx - size * Math.cos(angle + 0.45),
          by - size * Math.sin(angle + 0.45),
        );
        c.stroke();
      }
    };
    head(
      p[p.length - 4],
      p[p.length - 3],
      p[p.length - 2],
      p[p.length - 1],
      el.endHead || (el.type === "arrow" ? "arrow" : "none"),
    );
    head(p[2], p[3], p[0], p[1], el.startHead || "none");
    if (el.text) {
      const mx = (p[0] + p[p.length - 2]) / 2,
        my = (p[1] + p[p.length - 1]) / 2;
      drawText(
        c,
        el.text,
        mx - 90,
        my - 24,
        180,
        el.fontSize || style.fontSize || 18,
        { ...el, style: { ...style, align: "center" } },
        dark,
      );
    }
  } else if (el.type === "image") {
    const image = images.get(el.assetId || "");
    if (image?.complete && image.naturalWidth > 0)
      c.drawImage(image, x, y, w, h);
    else {
      c.fillStyle = "#e7ebe6";
      c.fillRect(x, y, w, h);
      c.fillStyle = "#526056";
      c.font = "14px sans-serif";
      c.fillText(
        image?.dataset.failed ? "Image unavailable" : "Loading image…",
        x + 12,
        y + 24,
      );
    }
  } else if (el.type === "text") {
    drawText(
      c,
      el.text || "",
      x,
      y,
      w || 300,
      el.fontSize || style.fontSize || 20,
      el,
      dark,
    );
  } else {
    c.beginPath();
    switch (el.type) {
      case "ellipse":
        c.ellipse(
          x + w / 2,
          y + h / 2,
          Math.abs(w / 2),
          Math.abs(h / 2),
          0,
          0,
          Math.PI * 2,
        );
        break;
      case "roundrect":
      case "mindnode":
      case "sticky":
        c.roundRect(x, y, w, h, el.type === "sticky" ? 2 : 12);
        break;
      case "diamond":
        polygon(c, [
          [x + w / 2, y],
          [x + w, y + h / 2],
          [x + w / 2, y + h],
          [x, y + h / 2],
        ]);
        break;
      case "triangle":
        polygon(c, [
          [x + w / 2, y],
          [x + w, y + h],
          [x, y + h],
        ]);
        break;
      case "parallelogram":
        polygon(c, [
          [x + w * 0.2, y],
          [x + w, y],
          [x + w * 0.8, y + h],
          [x, y + h],
        ]);
        break;
      case "hexagon":
        polygon(c, [
          [x + w * 0.2, y],
          [x + w * 0.8, y],
          [x + w, y + h / 2],
          [x + w * 0.8, y + h],
          [x + w * 0.2, y + h],
          [x, y + h / 2],
        ]);
        break;
      default:
        c.rect(x, y, w, h);
    }
    if (el.type === "sticky") {
      c.fillStyle = el.color || "#F3D98B";
      c.fill();
    } else if (style.fill) c.fill();
    c.stroke();
    if (el.type === "frame") {
      c.fillStyle = ink;
      c.font = '13px "Public Sans Variable",sans-serif';
      c.fillText(el.title || "Frame", x, y - 12);
    } else if (el.text)
      drawText(
        c,
        el.text,
        x + 12,
        y + 12,
        Math.max(20, w - 24),
        el.fontSize || style.fontSize || 18,
        el,
        dark && el.type !== "sticky" && !style.fill,
      );
    if (el.type === "sticky") {
      c.fillStyle = style.stroke;
      c.font = 'bold 11px "Public Sans Variable",sans-serif';
      c.fillText(
        el.authorName.slice(0, 2).toUpperCase(),
        x + w - 28,
        y + h - 12,
      );
    }
  }
  c.restore();
}
function polygon(c: CanvasRenderingContext2D, p: number[][]) {
  c.moveTo(p[0][0], p[0][1]);
  for (const [x, y] of p.slice(1)) c.lineTo(x, y);
  c.closePath();
}
function drawText(
  c: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  size: number,
  el: Element,
  dark = false,
) {
  c.fillStyle = viewportInk(el.style.stroke, dark);
  c.font = `${el.style.italic ? "italic " : ""}${el.style.bold ? "700 " : "400 "}${size}px "Public Sans Variable",sans-serif`;
  c.textBaseline = "top";
  c.textAlign = el.style.align || "left";
  const left =
    c.textAlign === "center"
      ? x + width / 2
      : c.textAlign === "right"
        ? x + width
        : x;
  let line = "",
    row = 0;
  for (const paragraph of text.split("\n")) {
    for (const word of paragraph.split(" ")) {
      const next = line ? line + " " + word : word;
      if (c.measureText(next).width > width && line) {
        c.fillText(line, left, y + row++ * size * 1.35);
        line = word;
      } else line = next;
    }
    c.fillText(line, left, y + row++ * size * 1.35);
    line = "";
  }
}
/** Render z-ordered primitives with mind-map edges derived before their node bodies. */
export function renderBoard(
  c: CanvasRenderingContext2D,
  state: BoardState,
  list = Object.values(state.elements),
  dark = false,
) {
  const hidden = new Set<string>();
  for (const el of list) {
    let p = el.parentId;
    const seen = new Set<string>();
    while (p && state.elements[p] && !seen.has(p)) {
      seen.add(p);
      if (state.elements[p].collapsed) hidden.add(el.id);
      p = state.elements[p].parentId;
    }
  }
  for (const el of list)
    if (el.type === "mindnode" && el.parentId && !hidden.has(el.id)) {
      const parent = state.elements[el.parentId];
      if (parent) {
        c.save();
        c.strokeStyle = viewportInk(el.style.stroke, dark);
        c.lineWidth = 2;
        c.beginPath();
        const ax = parent.x + (parent.w || 0) / 2,
          ay = parent.y + (parent.h || 0) / 2,
          bx = el.x + (el.w || 0) / 2,
          by = el.y + (el.h || 0) / 2;
        c.moveTo(ax, ay);
        c.bezierCurveTo((ax + bx) / 2, ay, (ax + bx) / 2, by, bx, by);
        c.stroke();
        c.restore();
      }
    }
  for (const el of [...list].sort((a, b) =>
    a.z < b.z ? -1 : a.z > b.z ? 1 : a.id.localeCompare(b.id),
  ))
    if (!hidden.has(el.id)) renderElement(c, el, state.elements, dark);
}
