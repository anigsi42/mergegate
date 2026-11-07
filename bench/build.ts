// Turns each Case's edits into a real unified diff against bench/fixture.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PullRequest } from "../src/evidence.ts";
import { CASES, Case } from "./cases.ts";

export const FIXTURE = fileURLToPath(new URL("./fixture", import.meta.url));

export function buildPatch(c: Case): string {
  const dir = mkdtempSync(join(tmpdir(), "mg-build-"));
  cpSync(FIXTURE, dir, { recursive: true });
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.email=b@b", "-c", "user.name=b", "commit", "-qm", "base");
  for (const e of c.edits) {
    const p = join(dir, e.file);
    if (e.content === null) { rmSync(p); continue; }
    if (e.content !== undefined) { writeFileSync(p, e.content); continue; }
    const src = readFileSync(p, "utf8");
    if (!src.includes(e.find!)) throw new Error(`[${c.id}] find not found in ${e.file}: ${e.find!.slice(0, 60)}`);
    writeFileSync(p, src.replace(e.find!, () => e.replace ?? ""));
  }
  git("add", "-A");
  const patch = git("diff", "--cached");
  rmSync(dir, { recursive: true, force: true });
  return patch;
}

export function toPR(c: Case): PullRequest {
  return { id: c.id, title: c.title, description: c.description, patch: buildPatch(c) };
}

export function cases(split?: "train" | "holdout") {
  return CASES.filter((c) => !split || c.split === split);
}
