/** Local user-data persistence survives restarts without exposing filesystem access to React. */
import { app } from "electron";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
/** Keys are hashed/allowlisted by the caller; renderer never supplies filesystem paths. */
export function readStore(key: string): unknown {
  try {
    return JSON.parse(
      readFileSync(join(app.getPath("userData"), key + ".json"), "utf8"),
    );
  } catch {
    return null;
  }
}
/** Atomic local persistence keeps a partially written queue from replacing the last valid one. */
export function writeStore(key: string, value: unknown) {
  const dir = app.getPath("userData");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, key + ".json");
  writeFileSync(path + ".tmp", JSON.stringify(value));
  renameSync(path + ".tmp", path);
}
