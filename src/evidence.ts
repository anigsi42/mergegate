// Deterministic evidence: apply the PR in an isolated copy, run the suite before
// and after, and extract structural signals from the diff. No model involved.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

export interface PullRequest {
  id: string;
  title: string;
  description: string;
  patch: string;
}

export interface TestRun {
  ok: boolean;
  pass: number;
  fail: number;
  total: number;
  output: string;
}

export interface Signals {
  filesChanged: string[];
  testFilesChanged: string[];
  srcFilesChanged: string[];
  linesAdded: number;
  linesRemoved: number;
  assertionsRemoved: number;
  assertionsAdded: number;
  testsSkippedAdded: number;
  emptyCatchAdded: number;
  testEnvSpecialCase: number;
  secretsAdded: number;
  testOnlyChange: boolean;
}

export interface Evidence {
  applied: boolean;
  applyError?: string;
  before: TestRun;
  after: TestRun;
  signals: Signals;
  workdir: string;
}

const TEST_FILE = /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/;

export function runTests(dir: string, cmd = process.env.GATE_TEST_CMD ?? "node --test"): TestRun {
  const [bin, ...args] = cmd.split(" ");
  const r = spawnSync(bin, args, { cwd: dir, encoding: "utf8", timeout: 60_000, env: { ...process.env, NODE_ENV: "test" } });
  const output = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const num = (re: RegExp) => Number(output.match(re)?.[1] ?? 0);
  const pass = num(/^# pass (\d+)/m);
  const fail = num(/^# fail (\d+)/m);
  return { ok: r.status === 0, pass, fail, total: num(/^# tests (\d+)/m) || pass + fail, output: output.slice(-4000) };
}

export function diffSignals(patch: string): Signals {
  const files: string[] = [];
  let current = "";
  const s: Signals = {
    filesChanged: files,
    testFilesChanged: [],
    srcFilesChanged: [],
    linesAdded: 0,
    linesRemoved: 0,
    assertionsRemoved: 0,
    assertionsAdded: 0,
    testsSkippedAdded: 0,
    emptyCatchAdded: 0,
    testEnvSpecialCase: 0,
    secretsAdded: 0,
    testOnlyChange: false,
  };
  const ASSERT = /\b(assert(\.\w+)?\s*\(|expect\s*\()/;
  for (const line of patch.split("\n")) {
    const m = line.match(/^\+\+\+ b\/(.+)$/);
    if (m) {
      current = m[1];
      files.push(current);
      continue;
    }
    if (line.startsWith("---") || line.startsWith("+++")) continue;
    const isTest = TEST_FILE.test(current);
    if (line.startsWith("+")) {
      s.linesAdded++;
      const l = line.slice(1);
      if (isTest && ASSERT.test(l)) s.assertionsAdded++;
      if (isTest && /\.(skip|todo)\s*\(|\{\s*skip\s*:\s*true|\bxit\s*\(/.test(l)) s.testsSkippedAdded++;
      if (!isTest && /catch\s*(\([^)]*\))?\s*\{\s*\}/.test(l)) s.emptyCatchAdded++;
      if (!isTest && /NODE_ENV\s*===?\s*['"]test['"]|process\.env\.NODE_TEST/.test(l)) s.testEnvSpecialCase++;
      if (/(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,})/.test(l)) s.secretsAdded++;
    } else if (line.startsWith("-")) {
      s.linesRemoved++;
      if (isTest && ASSERT.test(line.slice(1))) s.assertionsRemoved++;
    }
  }
  s.testFilesChanged = files.filter((f) => TEST_FILE.test(f));
  s.srcFilesChanged = files.filter((f) => !TEST_FILE.test(f));
  s.testOnlyChange = s.srcFilesChanged.length === 0 && s.testFilesChanged.length > 0;
  return s;
}

export function gatherEvidence(baseDir: string, pr: PullRequest): Evidence {
  const workdir = mkdtempSync(join(tmpdir(), "mergegate-"));
  cpSync(baseDir, workdir, { recursive: true, filter: (p) => !p.includes("node_modules") && !p.endsWith("/.git") });
  const git = (...a: string[]) => execFileSync("git", a, { cwd: workdir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  git("init", "-q");
  git("-c", "user.email=gate@local", "-c", "user.name=gate", "add", "-A");
  git("-c", "user.email=gate@local", "-c", "user.name=gate", "commit", "-qm", "base");

  const before = runTests(workdir);
  let applied = true;
  let applyError: string | undefined;
  try {
    writeFileSync(join(workdir, ".pr.patch"), pr.patch);
    git("apply", "--whitespace=nowarn", ".pr.patch");
  } catch (e: any) {
    applied = false;
    applyError = String(e.stderr ?? e.message).slice(0, 1000);
  }
  const after = applied ? runTests(workdir) : { ok: false, pass: 0, fail: 0, total: 0, output: "patch did not apply" };
  return { applied, applyError, before, after, signals: diffSignals(pr.patch), workdir };
}

// Tools the judge agent can call against the post-PR workspace.
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      if (f === ".git" || f === "node_modules" || f.startsWith(".pr")) continue;
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p));
    }
  };
  walk(dir);
  return out;
}

export function readFile(dir: string, path: string): string {
  const full = join(dir, path);
  if (!full.startsWith(dir)) throw new Error("path escapes workspace");
  return readFileSync(full, "utf8").slice(0, 12_000);
}

export function grep(dir: string, pattern: string): string {
  const r = spawnSync("git", ["grep", "--untracked", "-n", "-I", "-E", pattern], { cwd: dir, encoding: "utf8" });
  return (r.stdout || "(no matches)").slice(0, 6000);
}

export function runSnippet(dir: string, code: string): string {
  // Lets the judge write an adversarial probe against the patched code.
  const file = join(dir, ".pr.probe.mjs");
  writeFileSync(file, code);
  const r = spawnSync("node", [file], { cwd: dir, encoding: "utf8", timeout: 15_000 });
  return `exit=${r.status}\n${(r.stdout ?? "").slice(0, 3000)}\n${(r.stderr ?? "").slice(0, 2000)}`;
}
