/** Three real Electron clients exercise TCP propagation and capture the design review matrix. */
import { _electron as electron } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const run = crypto.randomUUID(),
  port = 15050;
mkdirSync("design/screens", { recursive: true });
mkdirSync(".runtime/e2e/" + run, { recursive: true });
const server = spawn(
  process.execPath,
  [
    "dist/server.cjs",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--data",
    ".runtime/e2e/" + run + "/server",
    "--no-discovery",
  ],
  { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
);
const apps = [],
  pages = [],
  errors = [],
  requests = [];
const shot = async (page, name) => {
  await page.mouse.move(4, 4);
  await page.waitForTimeout(220);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: "design/screens/" + name + ".png",
    scale: "css",
  });
};
async function draw(page, tool, x, y, dx = 150, dy = 90) {
  await page.getByRole("button", { name: tool, exact: true }).click();
  const box = await page
    .locator('canvas[aria-label^="Shared whiteboard"]')
    .boundingBox();
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + dx, box.y + y + dy, { steps: 15 });
  await page.mouse.up();
}
async function tabTo(page, locator) {
  for (let i = 0; i < 140; i++) {
    if (
      await locator
        .evaluate((el) => el === document.activeElement)
        .catch(() => false)
    )
      return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Keyboard focus could not reach " + String(locator));
}
async function checkDialogKeyboard(page) {
  const opener = page.getByRole("button", { name: "Workspace settings" });
  await tabTo(page, opener);
  await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: "Workspace settings" }).waitFor();
  await page.waitForFunction(() =>
    document.querySelector("[role=dialog]")?.contains(document.activeElement),
  );
  await page.keyboard.press("Shift+Tab");
  if (
    !(await page
      .getByRole("dialog")
      .evaluate((el) => el.contains(document.activeElement)))
  )
    throw new Error("Shift+Tab escaped dialog");
  await page.keyboard.press("Tab");
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    if (
      !(await page
        .getByRole("dialog")
        .evaluate((el) => el.contains(document.activeElement)))
    )
      throw new Error("Tab escaped dialog");
  }
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  if (!(await opener.evaluate((el) => el === document.activeElement)))
    throw new Error("Focus did not return to settings");
}
try {
  await new Promise((resolve, reject) => {
    server.stdout.once("data", resolve);
    server.once("error", reject);
    server.once("exit", (code) => {
      if (code) reject(new Error("Server exited " + code));
    });
  });
  let code = "";
  for (let i = 0; i < 3; i++) {
    const app = await electron.launch({
      ...(process.env.CANVAS_TEST_EXECUTABLE
        ? { executablePath: resolve(process.env.CANVAS_TEST_EXECUTABLE) }
        : {}),
      args: [
        ...(!process.env.CANVAS_TEST_EXECUTABLE
          ? ["dist/client/main.cjs"]
          : []),
        `--user-data-dir=${resolve(".runtime/e2e/" + run + "/client-" + i)}`,
      ],
      timeout: 60000,
    });
    apps.push(app);
    const page = await app.firstWindow();
    pages.push(page);
    page.setDefaultTimeout(12000);
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("request", (request) => requests.push(request.url()));
    await page
      .getByRole("heading", { name: "Bring everyone to the board." })
      .waitFor();
    if (i === 0) {
      await shot(page, "connect-light");
      await page.evaluate(
        () => (document.documentElement.dataset.theme = "dark"),
      );
      await shot(page, "connect-dark");
      await page.evaluate(
        () => (document.documentElement.dataset.theme = "light"),
      );
    }
    await page
      .getByRole("textbox", { name: "Server address" })
      .fill("127.0.0.1:" + port);
    await page
      .getByRole("textbox", { name: "Your name" })
      .fill(["Ada", "Ben", "Cora"][i]);
    if (i === 0)
      await page.getByRole("button", { name: "Create workspace" }).click();
    else {
      await page.getByRole("tab", { name: "Join room" }).click();
      await page.getByRole("textbox", { name: "Room code" }).fill(code);
      await page.getByRole("button", { name: "Join workspace" }).click();
    }
    await page.getByRole("navigation", { name: "Drawing tools" }).waitFor();
    if (!i) code = (await page.locator("button.code").textContent()).trim();
    console.log("Client joined", i);
  }
  const [a, b] = pages;
  await a.getByRole("button", { name: "Close workspace panel" }).click();
  await shot(a, "board-shell-light");
  await draw(a, "Pen (P)", 300, 220, 180, 100);
  await b.getByText("1 elements", { exact: false }).waitFor();
  console.log("Stroke propagated");
  await draw(a, "Rectangle (R)", 360, 340, 180, 110);
  await draw(a, "Ellipse (O)", 650, 340, 140, 110);
  await draw(a, "Arrow (A)", 540, 395, 110, 0);
  await draw(a, "Sticky note (S)", 600, 180, 0, 0);
  await a
    .getByRole("textbox", { name: "Edit element text" })
    .fill("One source of truth.\nEvery change has a sequence.");
  await a.getByRole("button", { name: "Pen (P)", exact: true }).click();
  await draw(a, "Mind map (M)", 350, 530, 0, 0);
  await a
    .getByRole("textbox", { name: "Edit element text" })
    .fill("Reliable collaboration");
  await a.getByRole("button", { name: "Pen (P)", exact: true }).click();
  const png = await a.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 80;
    const c = canvas.getContext("2d");
    c.fillStyle = "#F3D98B";
    c.fillRect(0, 0, 120, 80);
    c.fillStyle = "#243E36";
    c.font = "20px sans-serif";
    c.fillText("LAN", 35, 48);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await a.locator("input[type=file]").setInputFiles({
    name: "sample.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await a.getByText("7 elements", { exact: false }).waitFor();
  await a.getByRole("button", { name: "Select (V)", exact: true }).click();
  const stage = await a
    .locator('canvas[aria-label^="Shared whiteboard"]')
    .boundingBox();
  await a.mouse.click(stage.x + 450, stage.y + 395);
  await a.mouse.move(stage.x + 540, stage.y + 395);
  await a.mouse.down();
  await a.mouse.move(stage.x + 850, stage.y + 510, { steps: 12 });
  await a.mouse.up();
  await a.waitForTimeout(400);
  const diagram = await a.evaluate(
    (key) => window.canvas.read(key),
    "127.0.0.1:" + port + "/" + code,
  );
  if (
    !Object.values(diagram.confirmed.elements).some(
      (el) => el.type === "arrow" && el.start && el.end,
    )
  )
    throw new Error("Drag-to-connect did not bind both ends");
  await a.getByRole("button", { name: "Canvas objects", exact: true }).click();
  await a
    .getByRole("textbox", { name: "Find an object" })
    .fill("Reliable collaboration");
  await a
    .getByRole("button", { name: /mindnode: Reliable collaboration/ })
    .click();
  await a.keyboard.press("Tab");
  await a
    .getByRole("textbox", { name: "Edit element text" })
    .fill("Recovery branch");
  await a.keyboard.press("Escape");
  await a.waitForTimeout(400);
  const mind = await a.evaluate(
    (key) => window.canvas.read(key),
    "127.0.0.1:" + port + "/" + code,
  );
  if (
    !Object.values(mind.confirmed.elements).some(
      (el) =>
        el.type === "mindnode" && el.parentId && el.text === "Recovery branch",
    )
  )
    throw new Error("Mind-map child was not committed");
  await draw(a, "Frame (F)", 260, 140, 650, 480);
  console.log("Content tools created");
  await a.getByRole("button", { name: "Toggle collaboration panel" }).click();
  await a.getByRole("tab", { name: "Chat", exact: true }).click();
  await a
    .getByRole("textbox", { name: "Message everyone" })
    .fill("Let’s sketch the recovery flow.");
  await a.getByRole("button", { name: "Send message" }).click();
  await b
    .getByText("Let’s sketch the recovery flow.", { exact: true })
    .waitFor();
  await shot(a, "chat-light");
  await a.getByRole("tab", { name: "People", exact: true }).click();
  await shot(a, "people-light");
  await a.getByRole("tab", { name: "History", exact: true }).click();
  await a.getByRole("textbox", { name: "Version name" }).fill("First workshop");
  await a.getByRole("button", { name: "Save version", exact: true }).click();
  await a.getByText("First workshop", { exact: true }).waitFor();
  await shot(a, "history-light");
  await a.getByRole("tab", { name: "Frames", exact: true }).click();
  await shot(a, "frames-light");
  await a.getByRole("button", { name: "Workspace settings" }).click();
  await shot(a, "settings-light");
  await a.getByRole("combobox", { name: /Theme/ }).selectOption("dark");
  await a.getByRole("button", { name: "Close panel" }).click();
  await shot(a, "board-dark");
  for (const tab of ["Chat", "People", "History", "Frames"]) {
    await a.getByRole("tab", { name: tab, exact: true }).click();
    await shot(a, tab.toLowerCase() + "-dark");
  }
  await a.getByRole("button", { name: "Export", exact: true }).click();
  await shot(a, "export-dark");
  const exportDir = resolve(".runtime/e2e/" + run + "/exports");
  mkdirSync(exportDir, { recursive: true });
  await apps[0].evaluate(({ dialog }, directory) => {
    dialog.showSaveDialog = async (_window, options) => ({
      canceled: false,
      filePath: directory + "/" + options.defaultPath,
    });
  }, exportDir);
  const exports = [];
  for (const format of ["png", "svg", "pdf", "wbboard"]) {
    await a
      .getByRole("combobox", { name: "Format", exact: true })
      .selectOption(format);
    await a.getByRole("button", { name: "Save export", exact: true }).click();
    const path = exportDir + "/Canvas." + format;
    for (let attempt = 0; attempt < 100 && !existsSync(path); attempt++)
      await a.waitForTimeout(100);
    const data = readFileSync(path);
    if (format === "png" && data.subarray(1, 4).toString() !== "PNG")
      throw new Error("Invalid PNG export");
    if (format === "pdf" && !data.toString().startsWith("%PDF-"))
      throw new Error("Invalid PDF export");
    if (
      format === "svg" &&
      (await a.evaluate(
        (text) =>
          new DOMParser()
            .parseFromString(text, "image/svg+xml")
            .querySelector("parsererror") !== null,
        data.toString(),
      ))
    )
      throw new Error("Invalid SVG export");
    if (
      format === "wbboard" &&
      Object.keys(JSON.parse(data.toString()).state.elements).length < 8
    )
      throw new Error("Incomplete board export");
    exports.push({ format, bytes: data.length });
  }
  writeFileSync(
    "design/screens/export-result.json",
    JSON.stringify(exports, null, 2),
  );
  await a.getByRole("button", { name: "Close panel" }).click();
  await a.getByRole("button", { name: "Workspace settings" }).click();
  await a.getByRole("combobox", { name: /Theme/ }).selectOption("light");
  await a.getByRole("button", { name: "Close panel" }).click();
  await shot(a, "board-light");
  await a.getByRole("button", { name: "Export", exact: true }).click();
  await shot(a, "export-light");
  await a.getByRole("button", { name: "Close panel" }).click();
  await a.getByRole("button", { name: "Start presentation (F5)" }).click();
  await a.getByRole("button", { name: "End presentation" }).waitFor();
  await shot(a, "presentation-light");
  await a.getByRole("button", { name: "End presentation" }).click();
  await a.keyboard.press("?");
  await shot(a, "shortcuts-light");
  await a.getByRole("button", { name: "Close panel" }).click();
  const keyboardPage = pages[2];
  await tabTo(
    keyboardPage,
    keyboardPage.getByRole("button", { name: "Leave workspace" }),
  );
  await keyboardPage.keyboard.press("Enter");
  await keyboardPage
    .getByRole("heading", { name: "Bring everyone to the board." })
    .waitFor();
  await tabTo(
    keyboardPage,
    keyboardPage.getByRole("tab", { name: "Create room" }),
  );
  await keyboardPage.keyboard.press("ArrowRight");
  await tabTo(
    keyboardPage,
    keyboardPage.getByRole("textbox", { name: "Room code" }),
  );
  await keyboardPage.keyboard.type(code);
  await tabTo(
    keyboardPage,
    keyboardPage.getByRole("button", { name: "Join workspace" }),
  );
  await keyboardPage.keyboard.press("Enter");
  await keyboardPage
    .getByRole("navigation", { name: "Drawing tools" })
    .waitFor();
  await keyboardPage.keyboard.press("p");
  await tabTo(
    keyboardPage,
    keyboardPage.locator('canvas[aria-label^="Shared whiteboard"]'),
  );
  await keyboardPage.keyboard.press("Enter");
  await keyboardPage.waitForTimeout(350);
  await tabTo(
    keyboardPage,
    keyboardPage.getByRole("textbox", { name: "Message everyone" }),
  );
  await keyboardPage.keyboard.type("Keyboard-only collaboration check");
  await keyboardPage.keyboard.press("Enter");
  await keyboardPage.waitForTimeout(350);
  await tabTo(
    keyboardPage,
    keyboardPage.getByRole("button", { name: "Leave workspace" }),
  );
  await keyboardPage.keyboard.press("Enter");
  await keyboardPage
    .getByRole("heading", { name: "Bring everyone to the board." })
    .waitFor();
  const layoutChecks = [];
  await a.locator('canvas[aria-label^="Shared whiteboard"]').focus();
  await a.keyboard.press("Escape");
  for (const theme of ["light", "dark"]) {
    await a.getByRole("button", { name: "Workspace settings" }).click();
    await a.getByRole("combobox", { name: /Theme/ }).selectOption(theme);
    await a.getByRole("button", { name: "Close panel" }).click();
    for (const scale of ["1", "1.25", "1.5"]) {
      await a.getByRole("button", { name: "Workspace settings" }).click();
      await a.getByRole("combobox", { name: /UI scale/ }).selectOption(scale);
      await a.getByRole("button", { name: "Close panel" }).click();
      await a.setViewportSize({ width: 1100, height: 650 });
      await checkDialogKeyboard(a);
      for (const target of [
        a.locator(".properties input[type=range]").first(),
        a.getByLabel("Fill color", { exact: true }),
        a.getByRole("button", { name: "No fill", exact: true }),
        a.getByText("More", { exact: true }),
        a.locator(".dock [role=tab][aria-selected=true]"),
      ]) {
        await tabTo(a, target);
        const visible = await target.evaluate((el) => {
          const r = el.getBoundingClientRect(),
            hit = document.elementFromPoint(
              r.x + r.width / 2,
              r.y + r.height / 2,
            );
          return (
            r.width > 0 && r.height > 0 && (hit === el || el.contains(hit))
          );
        });
        if (!visible) throw new Error("Keyboard control is obscured");
      }
      await shot(a, `board-${theme}-1100-${scale}`);
      const bounds = await a.evaluate(() => ({
        w: innerWidth,
        h: innerHeight,
        scroll: document.documentElement.scrollWidth,
        canvas: document
          .querySelector(".board-stage")
          .getBoundingClientRect()
          .toJSON(),
        scale: getComputedStyle(document.documentElement).getPropertyValue(
          "--scale",
        ),
      }));
      layoutChecks.push({ theme, scale, ...bounds });
      if (bounds.scroll > bounds.w + 1 || bounds.canvas.bottom > bounds.h + 2)
        throw new Error("Editor overflows at " + theme + "/" + scale);
    }
    await a.getByRole("button", { name: "Workspace settings" }).click();
    await a.getByRole("combobox", { name: /UI scale/ }).selectOption("1");
    await a.getByRole("button", { name: "Close panel" }).click();
    await a.setViewportSize({ width: 3840, height: 2160 });
    await shot(a, `board-${theme}-4k`);
  }
  writeFileSync(
    "design/screens/layout-checks.json",
    JSON.stringify(layoutChecks, null, 2),
  );
  await a.setViewportSize({ width: 1440, height: 900 });
  const states = [];
  for (const page of pages) {
    await page.waitForTimeout(350);
    const stored = await page.evaluate(
      (key) => window.canvas.read(key),
      "127.0.0.1:" + port + "/" + code,
    );
    states.push(stored.confirmed);
    if (stored.pending.length)
      throw new Error("Pending operations did not drain");
  }
  const hashes = states.map((state) =>
    createHash("sha256").update(JSON.stringify(state)).digest("hex"),
  );
  if (new Set(hashes).size !== 1) throw new Error("Confirmed replicas differ");
  const external = requests.filter((url) => /^https?:/.test(url));
  if (external.length)
    throw new Error("Unexpected HTTP requests: " + external.join(","));
  if (errors.length) throw new Error(errors.join("\n"));
  // A separate local/import/share flow must not affect the preceding replica comparison.
  const localPage=pages[2],boardFile=exportDir+'/Canvas.wbboard';
  await apps[2].evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},boardFile);
  await localPage.getByRole('button',{name:'Open a board',exact:true}).click();
  await localPage.getByRole('navigation',{name:'Drawing tools'}).waitFor();
  await localPage.getByRole('button',{name:'Workspace settings'}).click();await localPage.getByRole('button',{name:'Share to a server',exact:true}).click();
  await localPage.getByRole('button',{name:'Create workspace',exact:true}).click();await localPage.getByRole('navigation',{name:'Drawing tools'}).waitFor();
  const sharedCode=(await localPage.locator('button.code').textContent()).trim(),expected=Object.keys(JSON.parse(readFileSync(boardFile,'utf8')).state.elements).length;
  let shared;
  for(let attempt=0;attempt<100;attempt++){await localPage.waitForTimeout(100);shared=await localPage.evaluate(key=>window.canvas.read(key),'127.0.0.1:'+port+'/'+sharedCode);if(shared&&Object.keys(shared.confirmed.elements).length===expected&&!shared.pending.length)break;}
  if(!shared||Object.keys(shared.confirmed.elements).length!==expected||shared.pending.length)throw new Error('Imported local board failed to share');
  writeFileSync('design/screens/local-share-result.json',JSON.stringify({localImport:true,embeddedImages:true,shareToServer:true,elements:expected,pending:0},null,2));
  writeFileSync(
    "design/screens/e2e-result.json",
    JSON.stringify(
      {
        clients: 3,
        elements: Object.keys(states[0].elements).length,
        seq: states[0].seq,
        hashes,
        externalRequests: external,
        rendererErrors: errors,
        keyboardFlow:
          "Connect → draw → chat → leave via Tab and keyboard; dialog focus and property/dock reachability verified in both themes at100/125/150%",
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: 3 replicas equal; drawing/content/chat/versions/presentation work; no HTTP requests.",
  );
} catch (error) {
  for (let i = 0; i < pages.length; i++) {
    await shot(pages[i], "failure-" + i);
    console.log((await pages[i].locator("body").innerText()).slice(-2400));
  }
  throw error;
} finally {
  for (const app of apps) await app.close();
  server.stdin.write("quit\n");
  server.kill();
}
