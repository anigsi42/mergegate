// Run memory: every review and every learned lesson is persisted, so the gate
// carries what it learned into the next run. MongoDB when MONGODB_URI is set,
// otherwise a local JSON store (same interface).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Lesson {
  id: string;
  rule: string; // general, reusable review rule
  trigger: string; // what pattern in a PR should activate it
  source: string; // PR id that taught it
  createdAt: string;
  hits: number; // times it was cited in a correct verdict
  misses: number; // times it was cited in a wrong verdict
  retired?: boolean;
}

export interface RunRecord {
  runId: string;
  iteration: number;
  prId: string;
  verdict: "approve" | "block";
  expected?: "approve" | "block";
  correct?: boolean;
  confidence: number;
  findings: string[];
  lessonsUsed: string[];
  mode: "model" | "heuristic";
  provider?: string;
  tokens?: number;
  ms: number;
  at: string;
}

export interface Store {
  lessons(): Promise<Lesson[]>;
  saveLesson(l: Lesson): Promise<void>;
  updateLesson(id: string, patch: Partial<Lesson>): Promise<void>;
  saveRun(r: RunRecord): Promise<void>;
  runs(): Promise<RunRecord[]>;
  reset(): Promise<void>;
  close(): Promise<void>;
  kind: string;
}

class FileStore implements Store {
  kind = "file";
  constructor(private path: string) {}
  private load(): { lessons: Lesson[]; runs: RunRecord[] } {
    if (!existsSync(this.path)) return { lessons: [], runs: [] };
    return JSON.parse(readFileSync(this.path, "utf8"));
  }
  private save(d: { lessons: Lesson[]; runs: RunRecord[] }) {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(d, null, 2));
  }
  async lessons() { return this.load().lessons; }
  async saveLesson(l: Lesson) { const d = this.load(); d.lessons.push(l); this.save(d); }
  async updateLesson(id: string, patch: Partial<Lesson>) {
    const d = this.load();
    d.lessons = d.lessons.map((l) => (l.id === id ? { ...l, ...patch } : l));
    this.save(d);
  }
  async saveRun(r: RunRecord) { const d = this.load(); d.runs.push(r); this.save(d); }
  async runs() { return this.load().runs; }
  async reset() { this.save({ lessons: [], runs: [] }); }
  async close() {}
}

class MongoStore implements Store {
  kind = "mongodb";
  private client: any;
  private db: any;
  private constructor() {}
  static async connect(uri: string): Promise<MongoStore> {
    const { MongoClient } = await import("mongodb");
    const s = new MongoStore();
    s.client = new MongoClient(uri);
    await s.client.connect();
    s.db = s.client.db(process.env.MONGODB_DB ?? "mergegate");
    return s;
  }
  async lessons() { return this.db.collection("lessons").find({}, { projection: { _id: 0 } }).toArray(); }
  async saveLesson(l: Lesson) { await this.db.collection("lessons").insertOne({ ...l }); }
  async updateLesson(id: string, patch: Partial<Lesson>) { await this.db.collection("lessons").updateOne({ id }, { $set: patch }); }
  async saveRun(r: RunRecord) { await this.db.collection("runs").insertOne({ ...r }); }
  async runs() { return this.db.collection("runs").find({}, { projection: { _id: 0 } }).sort({ at: 1 }).toArray(); }
  async reset() { await this.db.collection("lessons").deleteMany({}); await this.db.collection("runs").deleteMany({}); }
  async close() { await this.client.close(); }
}

export async function openStore(path = ".mergegate/store.json"): Promise<Store> {
  if (process.env.MONGODB_URI) return MongoStore.connect(process.env.MONGODB_URI);
  return new FileStore(path);
}
