/** Abrupt server termination and client restart verify durable offline intent and deduplicated recovery. */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { _electron as electron } from "playwright";
import { HeadlessClient } from "../headless-client";
import { msg } from "../../packages/shared/src/index";
async function main() {
  const data = ".runtime/recovery/" + crypto.randomUUID(),
    port = 16860;
  mkdirSync(data, { recursive: true });
  let processHandle: ChildProcess;
  const start = async () => {
    processHandle = spawn(
      process.execPath,
      [
        "dist/server.cjs",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--data",
        data + "/server",
        "--no-discovery",
      ],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    await new Promise<void>((resolve, reject) => {
      processHandle.stdout!.once("data", () => resolve());
      processHandle.once("error", reject);
    });
  };
  await start();
  let app: any;
  const launch = async () => {
    app = await electron.launch({
      args: [
        "dist/client/main.cjs",
        "--user-data-dir=" + resolve(data + "/client"),
      ],
      timeout: 60000,
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    await page
      .getByRole("heading", { name: "Bring everyone to the board." })
      .waitFor();
    return page;
  };
  try {
    let page = await launch();
    await page
      .getByRole("textbox", { name: "Server address" })
      .fill("127.0.0.1:" + port);
    await page
      .getByRole("textbox", { name: "Your name" })
      .fill("Recovery owner");
    await page.getByRole("button", { name: "Create workspace" }).click();
    await page.getByRole("navigation", { name: "Drawing tools" }).waitFor();
    const code = (await page.locator("button.code").textContent())!.trim();
    const draw = async () => {
      await page.getByRole("button", { name: "Pen (P)", exact: true }).click();
      const box = await page
        .locator('canvas[aria-label^="Shared whiteboard"]')
        .boundingBox();
      await page.mouse.move(box!.x + 250, box!.y + 250);
      await page.mouse.down();
      await page.mouse.move(box!.x + 450, box!.y + 320, { steps: 12 });
      await page.mouse.up();
    };
    await draw();
    await page.getByText("1 elements", { exact: false }).waitFor();
    await page.waitForTimeout(300);
    processHandle!.kill("SIGKILL");
    await new Promise((r) => processHandle!.once("exit", r));
    await page.waitForTimeout(250);
    await draw();
    await page.getByText("2 elements", { exact: false }).waitFor();
    await page.waitForTimeout(400);
    const key = "127.0.0.1:" + port + "/" + code,
      persisted = await page.evaluate(
        (key: string) => window.canvas.read(key),
        key,
      );
    if (persisted.pending.length !== 1)
      throw new Error("Offline op was not persisted");
    await app.close();
    app = null;
    await start();
    page = await launch();
    await page.getByRole("tab", { name: "Join room" }).click();
    await page.getByRole("textbox", { name: "Room code" }).fill(code);
    await page.getByRole("button", { name: "Join workspace" }).click();
    await page.getByRole("navigation", { name: "Drawing tools" }).waitFor();
    await page.getByText("2 elements", { exact: false }).waitFor();
    await page.waitForTimeout(400);
    const recovered = await page.evaluate(
      (key: string) => window.canvas.read(key),
      key,
    );
    if (
      recovered.pending.length ||
      Object.keys(recovered.confirmed.elements).length !== 2 ||
      recovered.confirmed.seq !== 2
    )
      throw new Error("Recovery duplicated or lost a gesture");
    const late = await new HeadlessClient().connect(port);
    late.send(msg("room_join", { code, username: "Verifier" }));
    const joined = await late.wait("join_ok");
    late.close();
    if (Object.keys(joined.p.snapshot.elements).length !== 2)
      throw new Error("Late joiner did not see recovered state");
    const result = {
      abruptServerKill: true,
      offlineQueuePersisted: 1,
      clientRestart: true,
      recoveredSeq: recovered.confirmed.seq,
      elements: 2,
      pending: 0,
      lateJoinerElements: 2,
    };
    mkdirSync("dist/evidence", { recursive: true });
    writeFileSync(
      "dist/evidence/recovery.json",
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (app) await app.close();
    processHandle!.stdin?.write("quit\n");
    processHandle!.kill();
  }
}
void main();
