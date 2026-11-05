/** Seed real shared model primitives over TCP; bots make multi-user demos reproducible. */
import { HeadlessClient } from "../headless-client";
import { generateKeyBetween } from "fractional-indexing";
import { createHash } from "node:crypto";
import {
  makeElement,
  msg,
  type Element,
} from "../../packages/shared/src/index";
const args = process.argv.slice(2),
  value = (name: string, fallback: string) =>
    args.includes(name) ? args[args.indexOf(name) + 1] || fallback : fallback;
async function main() {
  const [host, port] = value("--server", "127.0.0.1:5050").split(":"),
    room = value("--room", ""),
    bots = Number(value("--bots", "0"));
  const c = await new HeadlessClient().connect(Number(port), host);
  c.send(
    room
      ? msg("room_join", { code: room, username: "Canvas demo" })
      : msg("room_create", {
          name: "Systems workshop",
          username: "Canvas demo",
        }),
  );
  const joined = await c.wait("join_ok");
  const elements: Element[] = [];
  const add = (type: Element["type"], x: number, y: number, text?: string) => {
    const el = makeElement(type, crypto.randomUUID(), x, y);
    el.z = generateKeyBetween(elements.at(-1)?.z || null, null);
    el.text = text;
    elements.push(el);
    return el;
  };
  const frame = add("frame", 100, 100);
  frame.w = 960;
  frame.h = 540;
  frame.title = "From idea to system";
  const a = add("roundrect", 180, 230, "Client"),
    b = add("diamond", 520, 230, "Validate"),
    d = add("roundrect", 820, 230, "Broadcast");
  const arrow = add("arrow", 340, 280);
  arrow.points = [340, 280, 520, 280];
  arrow.start = { elId: a.id, anchor: "right" };
  arrow.end = { elId: b.id, anchor: "left" };
  const arrow2 = add("arrow", 680, 280);
  arrow2.points = [680, 280, 820, 280];
  arrow2.start = { elId: b.id, anchor: "right" };
  arrow2.end = { elId: d.id, anchor: "left" };
  const sticky = add(
    "sticky",
    240,
    430,
    "One source of truth.\nEvery change has a sequence.",
  );
  sticky.color = "#F3D98B";
  sticky.w = 250;
  sticky.h = 130;
  const root = add("mindnode", 200, 800, "Reliable collaboration"),
    child = add("mindnode", 480, 800, "Recovery");
  root.w = 220;
  root.h = 70;
  child.parentId = root.id;
  child.w = 180;
  child.h = 70;
  add("ellipse", 800, 800, "Discuss");
  const stroke = add("stroke", 600, 600);
  stroke.points = [600, 600, 640, 610, 680, 590, 720, 610];
  stroke.style.stroke = "#D55E00";
  // A bundled one-pixel PNG exercises the same verified asset transport as user images.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  const hash = createHash("sha256").update(png).digest("hex");
  c.send(
    msg("asset_put", {
      hash,
      mime: "image/png",
      size: png.length,
      idx: 0,
      total: 1,
      data: png.toString("base64"),
    }),
  );
  await c.wait("asset_put_ok");
  const image = add("image", 850, 450);
  image.assetId = hash;
  image.natW = 1;
  image.natH = 1;
  image.w = 64;
  image.h = 64;
  c.send(
    msg("op", {
      opId: crypto.randomUUID(),
      op: { kind: "batch", ops: elements.map((el) => ({ kind: "add", el })) },
    }),
  );
  await c.wait("op_applied");
  c.send(
    msg("chat_send", {
      cid: crypto.randomUUID(),
      text: "Demo board seeded with illustrative content.",
    }),
  );
  console.log("Room", joined.p.code);
  if (!bots) {
    c.close();
    return;
  }
  for (let i = 0; i < bots; i++) {
    const bot = await new HeadlessClient().connect(Number(port), host);
    bot.send(
      msg("room_join", { code: joined.p.code, username: "Drawing bot " + i }),
    );
    await bot.wait("join_ok");
    setInterval(() => {
      const el = makeElement("stroke", crypto.randomUUID());
      el.points = [
        Math.random() * 800,
        Math.random() * 600,
        Math.random() * 800,
        Math.random() * 600,
      ];
      el.style.stroke = ["#0072B2", "#D55E00", "#009E73"][i % 3];
      bot.send(
        msg("op", { opId: crypto.randomUUID(), op: { kind: "add", el } }),
      );
      bot.send(msg("ping", { n: Date.now() }));
    }, 2000);
  }
}
void main();
