/** Room files use sanitized codes, append-only operations and atomic checkpoint replacement. */
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  appendFileSync,
  readdirSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";
/** Directory boundary forbids user-controlled traversal at every file access. */
export class Persistence {
  constructor(private root: string) {
    mkdirSync(join(root, "rooms"), { recursive: true });
  }
  /** Only server-issued six-character room codes may reach the filesystem. */
  dir(code: string) {
    if (!/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(code))
      throw new Error("Invalid room code");
    const dir = join(this.root, "rooms", code);
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  /** Atomic rename ensures a crash leaves either the old checkpoint or the new one. */
  save(code: string, name: string, value: unknown) {
    const target = join(this.dir(code), name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target + ".tmp", JSON.stringify(value));
    renameSync(target + ".tmp", target);
  }
  /** Remove only an internal room-relative artifact selected from validated metadata. */
  remove(code: string, name: string) {
    const file = join(this.dir(code), name);
    if (existsSync(file)) unlinkSync(file);
  }
  /** Recover a JSON file; absent files are expected for a fresh room. */
  read<T>(code: string, name: string, fallback: T): T {
    const file = join(this.dir(code), name);
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, "utf8")) as T;
  }
  /** Append before broadcasting an acknowledged operation. */
  append(code: string, value: unknown) {
    appendFileSync(
      join(this.dir(code), "oplog.jsonl"),
      JSON.stringify(value) + "\n",
    );
  }
  /** Replay only complete lines after an interrupted append. */
  log(code: string): any[] {
    const file = join(this.dir(code), "oplog.jsonl");
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
  }
  /** Bound the log after a durable checkpoint has been written. */
  compact(code: string, ops: unknown[]) {
    const target = join(this.dir(code), "oplog.jsonl");
    writeFileSync(
      target + ".tmp",
      ops.map((o) => JSON.stringify(o)).join("\n") + "\n",
    );
    renameSync(target + ".tmp", target);
  }
  /** List persisted rooms without following arbitrary directory names. */
  codes() {
    return readdirSync(join(this.root, "rooms")).filter((c) =>
      /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(c),
    );
  }
}
