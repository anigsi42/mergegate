// Hidden oracle: a spec suite that neither the coding agents nor the gate ever
// see. It is the stand-in for production: a merged change that fails it is an
// escaped defect; a blocked change that passes it is a false block.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ORACLE_DIR = fileURLToPath(new URL("../arena/oracle", import.meta.url));

export interface OracleResult {
  pass: boolean;
  passed: number;
  failed: number;
  failures: string[]; // names of failing spec tests (kept out of agent/gate context)
}

// `codeDir` is a directory holding the (patched) library: src/, package.json.
export function runOracle(codeDir: string): OracleResult {
  const dir = mkdtempSync(join(tmpdir(), "oracle-"));
  try {
    cpSync(codeDir, dir, { recursive: true, filter: (p) => !p.includes("/.git") && !p.includes("node_modules") });
    cpSync(ORACLE_DIR, join(dir, ".oracle"), { recursive: true });
    const files = readdirSync(join(dir, ".oracle")).filter((f) => f.endsWith(".oracle.js")).map((f) => join(".oracle", f));
    const r = spawnSync("node", ["--test", "--test-timeout=20000", ...files], { cwd: dir, encoding: "utf8", timeout: 90_000 });
    const out = `${r.stdout ?? ""}`;
    const num = (re: RegExp) => Number(out.match(re)?.[1] ?? 0);
    const failures = [...out.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((m) => m[1]).filter((n) => !n.endsWith(".oracle.js"));
    const failed = num(/^# fail (\d+)/m);
    return { pass: r.status === 0 && failed === 0, passed: num(/^# pass (\d+)/m), failed, failures };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
