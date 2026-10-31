// Removes this machine's absolute paths from the source maps `bb plugin build`
// writes, so committed release artifacts do not reveal the build directory.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const dist = join(root, "dist");
for (const name of readdirSync(dist).filter((file) => file.endsWith(".map"))) {
  const file = join(dist, name);
  const text = readFileSync(file, "utf8");
  const stripped = text.split(`${root}/`).join("");
  if (stripped !== text) writeFileSync(file, stripped);
}
