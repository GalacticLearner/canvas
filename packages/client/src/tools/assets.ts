/** Image insertion downsizes and hashes content before chunked TCP transfer. */
import { msg, LIMITS } from "../../../shared/src/index";
import { send, useWorkspace, notify } from "../stores/workspace";
import { images } from "../canvas/render";
import { assetData } from "../export/boardExport";
import { readAsset, writeAsset } from "./assetCache";
const chunks = new Map<string, { mime: string; parts: string[] }>();
const downloads = new Map<string, ReturnType<typeof setTimeout>>();
/** Verified local image cache is reused by canvas rendering and portable exports. */
export function cacheImage(hash: string, data: string) {
  clearTimeout(downloads.get(hash));
  downloads.delete(hash);
  assetData.set(hash, data);
  const image = new Image();
  image.onload = () => window.dispatchEvent(new Event("canvas:asset-ready"));
  image.onerror = () => {
    image.dataset.failed = "true";
    window.dispatchEvent(new Event("canvas:asset-ready"));
    notify("An image could not be decoded");
  };
  image.src = data;
  images.set(hash, image);
  void window.canvas.write("asset/" + hash, data);
  void writeAsset(hash, data);
}
/** Upload already normalized data with bounded chunks; no oversized frame can be generated. */
export async function uploadImage(hash: string, data: string) {
  if (useWorkspace.getState().local) return;
  const response = (type: string) =>
    new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(
          new Error("Image transfer timed out. Try again when connected."),
        );
      }, 15000);
      const off = window.canvas.onMessage((e) => {
        if (e.t === type && e.p.hash === hash) {
          clearTimeout(timer);
          off();
          resolve(e.p);
        }
      });
    });
  const have = response("asset_have_result");
  await window.canvas.send(msg("asset_have", { hash }));
  if ((await have).have) return;
  const complete = response("asset_put_ok");
  // Attach rejection handling immediately, even if a subsequent IPC write fails.
  void complete.catch(() => {});
  useWorkspace.setState({ imageProgress: 0 });
  try {
    const raw = Uint8Array.from(atob(data.split(",")[1]), (c) =>
        c.charCodeAt(0),
      ),
      mime = data.slice(5, data.indexOf(";"));
    for (let idx = 0; idx < Math.ceil(raw.length / LIMITS.assetChunk); idx++) {
      const part = raw.subarray(
        idx * LIMITS.assetChunk,
        (idx + 1) * LIMITS.assetChunk,
      );
      let binary = "";
      for (const b of part) binary += String.fromCharCode(b);
      await window.canvas.send(
        msg("asset_put", {
          hash,
          mime: mime as "image/png",
          size: raw.length,
          idx,
          total: Math.ceil(raw.length / LIMITS.assetChunk),
          data: btoa(binary),
        }),
      );
      useWorkspace.setState({
        imageProgress: Math.round(
          ((idx + 1) / Math.ceil(raw.length / LIMITS.assetChunk)) * 100,
        ),
      });
    }
    await complete;
  } finally {
    useWorkspace.setState({ imageProgress: null });
  }
}
/** Normalize arbitrary browser-supported input to a bounded PNG/JPEG. */
export async function prepareImage(file: File) {
  if (
    !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)
  )
    throw new Error("Choose a PNG, JPEG, WebP or GIF image");
  const bitmap = await createImageBitmap(file),
    scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width * scale;
  canvas.height = bitmap.height * scale;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (blob && blob.size > 2 * 1024 * 1024)
    blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.8),
    );
  if (!blob || blob.size > 2 * 1024 * 1024)
    throw new Error("Image is too complex; choose a smaller image");
  const bytes = await blob.arrayBuffer(),
    hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  const data = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob!);
  });
  cacheImage(hash, data);
  await uploadImage(hash, data);
  return { hash, w: canvas.width, h: canvas.height };
}
/** Retrieve missing content through IPC and cache it locally between sessions. */
export function attachAssets() {
  const off = window.canvas.onMessage((e) => {
    if (e.t !== "asset_chunk") return;
    let entry = chunks.get(e.p.hash);
    if (!entry) {
      entry = { mime: e.p.mime, parts: [] };
      chunks.set(e.p.hash, entry);
    }
    entry.parts[e.p.idx] = e.p.data;
    if (entry.parts.filter(Boolean).length === e.p.total) {
      const bytes = entry.parts.map((p) => atob(p)).join("");
      cacheImage(e.p.hash, `data:${entry.mime};base64,${btoa(bytes)}`);
      chunks.delete(e.p.hash);
    }
  });
  const offStore = useWorkspace.subscribe((state) => {
    for (const el of Object.values(state.board.elements))
      if (el.type === "image" && el.assetId && !images.has(el.assetId)) {
        const hash = el.assetId;
        const placeholder = new Image();
        images.set(hash, placeholder);
        void readAsset(hash)
          .then(
            async (cached) =>
              cached || (await window.canvas.read("asset/" + hash)),
          )
          .then((data) => {
            if (data) cacheImage(hash, data);
            else if (!state.local) {
              send(msg("asset_get", { hash }));
              downloads.set(
                hash,
                setTimeout(() => {
                  placeholder.dataset.failed = "true";
                  chunks.delete(hash);
                  downloads.delete(hash);
                  window.dispatchEvent(new Event("canvas:asset-ready"));
                  notify("An image could not be downloaded. Rejoin to retry.");
                }, 15000),
              );
            } else {
              placeholder.dataset.failed = "true";
              notify("An image is missing from this local board");
            }
          });
      }
  });
  return () => {
    off();
    offStore();
    for (const timer of downloads.values()) clearTimeout(timer);
    downloads.clear();
    chunks.clear();
  };
}
