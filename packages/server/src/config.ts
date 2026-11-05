/** CLI and optional JSON configuration are resolved before opening any sockets. */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
/** Server configuration supports ephemeral ports for integration tests. */
export interface ServerConfig {
  host: string;
  port: number;
  name: string;
  data: string;
  maxClients: number;
  maxPerIp?: number;
  discovery: boolean;
  discoveryPort: number;
  graceMs: number;
  heartbeatMs: number;
  timeoutMs: number;
  logLevel: string;
}
/** Parse only documented flags; invalid ports fail before a listener is created. */
export function loadConfig(args = process.argv.slice(2)): ServerConfig {
  const { values } = parseArgs({
    args,
    options: {
      host: { type: "string" },
      port: { type: "string" },
      name: { type: "string" },
      data: { type: "string" },
      "max-clients": { type: "string" },
      "max-per-ip": { type: "string" },
      "no-discovery": { type: "boolean" },
      "discovery-port": { type: "string" },
      "log-level": { type: "string" },
      config: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "Canvas LAN server\n--host 0.0.0.0 --port 5050 --name Canvas --data ./data\n--max-clients 200 --max-per-ip 20 --discovery-port 5051 --no-discovery --log-level info --config config.json",
    );
    process.exit(0);
  }
  const file = values.config
    ? JSON.parse(readFileSync(values.config, "utf8"))
    : {};
  const config = {
    host: values.host || file.host || "0.0.0.0",
    port: Number(values.port || file.port || 5050),
    name: values.name || file.name || "Canvas studio",
    data: values.data || file.data || "data",
    maxClients: Number(values["max-clients"] || file.maxClients || 200),
    maxPerIp: Number(values["max-per-ip"] || file.maxPerIp || 20),
    discovery: !values["no-discovery"],
    discoveryPort: Number(
      values["discovery-port"] || file.discoveryPort || 5051,
    ),
    graceMs: 120000,
    heartbeatMs: 5000,
    timeoutMs: 15000,
    logLevel: values["log-level"] || "info",
  };
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535)
    throw new Error("Invalid TCP port");
  if (
    !Number.isInteger(config.discoveryPort) ||
    config.discoveryPort < 1 ||
    config.discoveryPort > 65535
  )
    throw new Error("Invalid UDP discovery port");
  return config;
}
