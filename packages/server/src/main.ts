/** Standalone server entry point: local CLI, graceful persistence and address banner. */
import { createInterface } from "node:readline";
import { loadConfig } from "./config";
import { CanvasServer } from "./server";
async function main() {
  const server = new CanvasServer(loadConfig());
  await server.listen();
  console.log(
    `[${new Date().toISOString()}] Canvas LAN server\n${server.addresses().join("\n")}\nTCP only. Allow the configured port through Windows Firewall for LAN clients.`,
  );
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  terminal.on("line", (line) => {
    if (line.trim() === "quit") void stop();
    else console.log(server.command(line));
  });
  const stats = setInterval(() => console.log(server.command("stats")), 10000);
  async function stop() {
    clearInterval(stats);
    terminal.close();
    await server.close();
    process.exit(0);
  }
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}
void main();
