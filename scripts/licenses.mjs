/** Generate a dependency/license inventory from the exact installed lockfile. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const seen = new Set(),
  lines = [
    "Canvas third-party dependency inventory",
    "Generated from package-lock.json. Fonts are bundled under OFL-1.1.",
    "Electron runtime also carries LICENSE and LICENSES.chromium.html.",
    "",
  ];
for (const [path, entry] of Object.entries(lock.packages || {})) {
  if (!path.startsWith("node_modules/")) continue;
  const file = path + "/package.json";
  if (!existsSync(file)) continue;
  const p = JSON.parse(readFileSync(file, "utf8")),
    key = p.name + "@" + p.version;
  if (seen.has(key)) continue;
  seen.add(key);
  lines.push(
    key +
      " — " +
      (typeof p.license === "string"
        ? p.license
        : JSON.stringify(p.license || entry.license || "See package license")),
  );
}
writeFileSync(
  "THIRD_PARTY.txt",
  [
    ...lines.slice(0, 4),
    ...lines.slice(4).sort((a, b) => a.localeCompare(b)),
  ].join("\n") + "\n",
);
