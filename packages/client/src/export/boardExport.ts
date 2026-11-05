/** Offline exports reuse the deterministic renderer and embed assets instead of remote links. */
import { boardSvg } from "./svg";
import {
  bounds,
  boardSchema,
  type BoardState,
} from "../../../shared/src/index";
import { renderBoard } from "../canvas/render";
/** Raw image data are keyed by SHA256 and shared by import/export and network caching. */
export const assetData = new Map<string, string>();
/** Bounds include negative coordinates and sensible padding for empty boards. */
export function boardBounds(state: BoardState) {
  const b = Object.values(state.elements).map((el) =>
    bounds(el, state.elements),
  );
  return b.length
    ? {
        x: Math.min(...b.map((v) => v.minX)) - 30,
        y: Math.min(...b.map((v) => v.minY)) - 30,
        w:
          Math.max(...b.map((v) => v.maxX)) -
          Math.min(...b.map((v) => v.minX)) +
          60,
        h:
          Math.max(...b.map((v) => v.maxY)) -
          Math.min(...b.map((v) => v.minY)) +
          60,
      }
    : { x: 0, y: 0, w: 1200, h: 800 };
}
/** Raster allocation has a strict pixel ceiling, preventing export from freezing a large board. */
export function raster(
  state: BoardState,
  scale = 1,
  transparent = false,
  region = boardBounds(state),
) {
  const canvas = document.createElement("canvas");
  const factor = Math.min(
    scale,
    8192 / Math.max(region.w, region.h),
    Math.sqrt(32000000 / (region.w * region.h)),
  );
  canvas.width = Math.max(1, Math.ceil(region.w * factor));
  canvas.height = Math.max(1, Math.ceil(region.h * factor));
  const c = canvas.getContext("2d")!;
  if (!transparent) {
    c.fillStyle = "#fff";
    c.fillRect(0, 0, canvas.width, canvas.height);
  }
  c.scale(factor, factor);
  c.translate(-region.x, -region.y);
  renderBoard(c, state);
  if (!transparent) {
    c.resetTransform();
    c.globalCompositeOperation = "destination-over";
    c.fillStyle = "#fff";
    c.fillRect(0, 0, canvas.width, canvas.height);
  }
  return canvas;
}
/** Version thumbnails are small self-contained PNGs. */
export function thumbnail(state: BoardState) {
  const b = boardBounds(state);
  return raster(state, 320 / Math.max(b.w, b.h)).toDataURL("image/png");
}
/** Save through a native dialog; renderer never chooses a filesystem path. */
export async function exportBoard(
  state: BoardState,
  format: string,
  scale = 1,
  transparent = false,
  region?: { x: number; y: number; w: number; h: number },
  name = "Canvas",
) {
  if (format === "wbboard")
    return window.canvas.save({
      name: name + ".wbboard",
      data: JSON.stringify({
        format: "canvas/1",
        state,
        assets: Object.fromEntries(
          [
            ...new Set(
              Object.values(state.elements)
                .filter((el) => el.type === "image" && el.assetId)
                .map((el) => el.assetId!),
            ),
          ]
            .filter((hash) => assetData.has(hash))
            .map((hash) => [hash, assetData.get(hash)]),
        ),
      }),
    });
  if (format === "png")
    return window.canvas.save({
      name: name + ".png",
      data: raster(state, scale, transparent, region)
        .toDataURL("image/png")
        .split(",")[1],
      base64: true,
    });
  if (format === "svg") {
    const b = region || boardBounds(state);
    return window.canvas.save({
      name: name + ".svg",
      data: boardSvg(state, b, assetData),
    });
  }
  const { jsPDF } = await import("jspdf");
  const b = region || boardBounds(state),
    pdf = new jsPDF({
      orientation: b.w > b.h ? "landscape" : "portrait",
      unit: "px",
      format: [Math.min(b.w, 10000), Math.min(b.h, 10000)],
    });
  pdf.addImage(
    raster(state, 1, false, b).toDataURL("image/png"),
    "PNG",
    0,
    0,
    Math.min(b.w, 10000),
    Math.min(b.h, 10000),
  );
  return window.canvas.save({
    name: name + ".pdf",
    data: pdf.output("datauristring").split(",")[1],
    base64: true,
  });
}
/** Export ordered frames as one PDF page each, or individual native image/vector files. */
export async function exportFrames(
  state: BoardState,
  format: string,
  scale = 1,
  transparent = false,
) {
  const frames = state.frames.map((id) => state.elements[id]).filter(Boolean);
  if (!frames.length) throw new Error("Add a frame before exporting slides");
  if (format !== "pdf") {
    let saved = false;
    for (const frame of frames)
      saved =
        (await exportBoard(
          state,
          format,
          scale,
          transparent,
          { x: frame.x, y: frame.y, w: frame.w || 640, h: frame.h || 360 },
          frame.title || "Frame",
        )) || saved;
    return saved;
  }
  const { jsPDF } = await import("jspdf");
  const first = frames[0],
    pdf = new jsPDF({
      unit: "px",
      orientation:
        (first.w || 640) > (first.h || 360) ? "landscape" : "portrait",
      format: [first.w || 640, first.h || 360],
    });
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i],
      w = f.w || 640,
      h = f.h || 360;
    if (i) pdf.addPage([w, h], w > h ? "landscape" : "portrait");
    pdf.addImage(
      raster(state, scale, false, { x: f.x, y: f.y, w, h }).toDataURL(
        "image/png",
      ),
      "PNG",
      0,
      0,
      w,
      h,
    );
  }
  return window.canvas.save({
    name: "Canvas-slides.pdf",
    data: pdf.output("datauristring").split(",")[1],
    base64: true,
  });
}
/** Imported files are schema-validated before replacing any current state. */
export function parseBoardFile(text: string) {
  if (text.length > 100 * 1024 * 1024)
    throw new Error("Board file is too large");
  const file = JSON.parse(text);
  if (file.format !== "canvas/1") throw new Error("Unsupported board format");
  const state = boardSchema.parse(file.state);
  if (
    file.assets &&
    (!file.assets ||
      typeof file.assets !== "object" ||
      Array.isArray(file.assets))
  )
    throw new Error("Invalid embedded assets");
  const assets = (file.assets || {}) as Record<string, string>;
  for (const [hash, data] of Object.entries(assets))
    if (
      !/^[a-f0-9]{64}$/.test(hash) ||
      typeof data !== "string" ||
      !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(data) ||
      data.length > 12 * 1024 * 1024
    )
      throw new Error("Invalid embedded image");
  return { state, assets };
}
