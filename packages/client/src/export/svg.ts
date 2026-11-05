/** Vector serialization preserves editable text, bound connectors and ordered pixel erasures. */
import {
  connectorPoints,
  isVisible,
  type BoardState,
  type Element,
} from "../../../shared/src/index";
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
/** Serialize the actual board geometry; image references must be embedded data URLs. */
export function boardSvg(
  state: BoardState,
  region: { x: number; y: number; w: number; h: number },
  assets: Map<string, string>,
) {
  const defs: string[] = [];
  let body = "";
  const shape = (el: Element): string => {
    const s = el.style,
      x = el.x,
      y = el.y,
      w = el.w || 0,
      h = el.h || 0,
      size = el.fontSize || s.fontSize || 20;
    const line = `stroke="${escape(s.stroke)}" stroke-width="${s.strokeWidth * (el.tool === "highlighter" ? 3 : 1)}" stroke-linecap="round" stroke-linejoin="round"${s.dash !== "solid" ? ` stroke-dasharray="${s.dash === "dashed" ? "10 7" : "1 6"}"` : ""}`,
      fill = `fill="${escape(s.fill || "none")}"`;
    let out = "";
    if (el.type === "image") {
      const data = assets.get(el.assetId || "");
      out = data?.startsWith("data:image/")
        ? `<image x="${x}" y="${y}" width="${w}" height="${h}" href="${escape(data)}"/>`
        : "";
    } else if (el.points) {
      const points =
        el.type === "line" || el.type === "arrow"
          ? connectorPoints(el, state.elements)
          : el.points;
      const end = points.length - 2;
      const path =
        el.route === "curve"
          ? `M ${points[0]} ${points[1]} C ${(points[0] + points[end]) / 2} ${points[1]} ${(points[0] + points[end]) / 2} ${points[end + 1]} ${points[end]} ${points[end + 1]}`
          : `M ${points[0]} ${points[1]} ` +
            Array.from(
              { length: points.length / 2 - 1 },
              (_, i) => `L ${points[(i + 1) * 2]} ${points[(i + 1) * 2 + 1]}`,
            ).join(" ");
      out = `<path d="${path}" ${line} fill="none"${el.tool === "highlighter" ? ' opacity="0.35"' : ""}/>`;
      const head = (
        ax: number,
        ay: number,
        bx: number,
        by: number,
        kind: string,
      ) => {
        if (kind === "none") return "";
        const angle = Math.atan2(by - ay, bx - ax),
          r = 12 + s.strokeWidth;
        if (kind === "dot")
          return `<circle cx="${bx}" cy="${by}" r="${r / 3}" fill="${escape(s.stroke)}"/>`;
        if (kind === "diamond")
          return `<polygon points="${bx},${by} ${bx - r * Math.cos(angle - 0.45)},${by - r * Math.sin(angle - 0.45)} ${bx - 2 * r * Math.cos(angle)},${by - 2 * r * Math.sin(angle)} ${bx - r * Math.cos(angle + 0.45)},${by - r * Math.sin(angle + 0.45)}" fill="${escape(s.stroke)}"/>`;
        return `<path d="M ${bx - r * Math.cos(angle - 0.45)} ${by - r * Math.sin(angle - 0.45)} L ${bx} ${by} L ${bx - r * Math.cos(angle + 0.45)} ${by - r * Math.sin(angle + 0.45)}" ${line} fill="none"/>`;
      };
      if (el.type === "arrow" || el.type === "line") {
        out += head(
          points[end - 2],
          points[end - 1],
          points[end],
          points[end + 1],
          el.endHead || (el.type === "arrow" ? "arrow" : "none"),
        );
        out += head(
          points[2],
          points[3],
          points[0],
          points[1],
          el.startHead || "none",
        );
      }
    } else if (el.type !== "text") {
      let tag = "";
      switch (el.type) {
        case "ellipse":
          tag = `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${Math.abs(w / 2)}" ry="${Math.abs(h / 2)}"`;
          break;
        case "diamond":
          tag = `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}"`;
          break;
        case "triangle":
          tag = `<polygon points="${x + w / 2},${y} ${x + w},${y + h} ${x},${y + h}"`;
          break;
        case "parallelogram":
          tag = `<polygon points="${x + w * 0.2},${y} ${x + w},${y} ${x + w * 0.8},${y + h} ${x},${y + h}"`;
          break;
        case "hexagon":
          tag = `<polygon points="${x + w * 0.2},${y} ${x + w * 0.8},${y} ${x + w},${y + h / 2} ${x + w * 0.8},${y + h} ${x + w * 0.2},${y + h} ${x},${y + h / 2}"`;
          break;
        default:
          tag = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${["roundrect", "mindnode"].includes(el.type) ? 12 : 0}"`;
      }
      out =
        tag +
        ` ${line} ${el.type === "sticky" ? `fill="${escape(el.color || "#F3D98B")}"` : fill}/>`;
    }
    const text = el.type === "frame" ? el.title : el.text;
    if (text) {
      const connector = el.type === "line" || el.type === "arrow",
        p = connector ? connectorPoints(el, state.elements) : null;
      const tx = p
          ? (p[0] + p[p.length - 2]) / 2 - 90
          : el.type === "text"
            ? x
            : x + 12,
        ty = p
          ? (p[1] + p[p.length - 1]) / 2 - 12
          : el.type === "frame"
            ? y - 12
            : y + size;
      out += `<text x="${tx}" y="${ty}" fill="${escape(s.stroke)}" font-family="sans-serif" font-size="${el.type === "frame" ? 13 : size}" font-weight="${s.bold ? 700 : 400}" font-style="${s.italic ? "italic" : "normal"}">${text
        .split("\n")
        .map(
          (line, i) =>
            `<tspan x="${tx}" dy="${i ? "1.35em" : "0"}">${escape(line)}</tspan>`,
        )
        .join("")}</text>`;
    }
    return `<g opacity="${s.opacity}"${el.angle ? ` transform="rotate(${(el.angle * 180) / Math.PI} ${x + w / 2} ${y + h / 2})"` : ""}>${out}</g>`;
  };
  for (const el of Object.values(state.elements).sort((a, b) =>
    a.z.localeCompare(b.z),
  )) {
    if (!isVisible(el, state.elements)) continue;
    if (el.type === "erase" && el.points) {
      const id = "mask-" + defs.length;
      defs.push(
        `<mask id="${id}" maskUnits="userSpaceOnUse" x="${region.x}" y="${region.y}" width="${region.w}" height="${region.h}"><rect x="${region.x}" y="${region.y}" width="${region.w}" height="${region.h}" fill="white"/><polyline points="${el.points.join(" ")}" stroke="black" stroke-width="${el.size || 20}" stroke-linecap="round" stroke-linejoin="round" fill="none"/></mask>`,
      );
      body = `<g mask="url(#${id})">${body}</g>`;
    } else {
      if (el.type === "mindnode" && el.parentId) {
        const parent = state.elements[el.parentId];
        if (parent) {
          const ax = parent.x + (parent.w || 0) / 2,
            ay = parent.y + (parent.h || 0) / 2,
            bx = el.x + (el.w || 0) / 2,
            by = el.y + (el.h || 0) / 2;
          body += `<path d="M ${ax} ${ay} C ${(ax + bx) / 2} ${ay} ${(ax + bx) / 2} ${by} ${bx} ${by}" fill="none" stroke="${escape(el.style.stroke)}" stroke-width="2"/>`;
        }
      }
      body += shape(el);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${region.w}" height="${region.h}" viewBox="${region.x} ${region.y} ${region.w} ${region.h}"><defs>${defs.join("")}</defs>${body}</svg>`;
}
