// Fixed-window limiter: at most `limit` calls per key per `windowMs`.
export function createLimiter(limit, windowMs) {
  const windows = new Map();
  let calls = 0;
  const prune = (now) => {
    for (const [k, w] of windows) if (now - w.start >= windowMs) windows.delete(k);
  };
  return {
    allow(key, now = Date.now()) {
      if (typeof key !== "string" || key === "") throw new TypeError("key required");
      if (++calls % 1000 === 0) prune(now);
      const w = windows.get(key);
      if (!w || now - w.start >= windowMs) {
        windows.set(key, { start: now, count: 1 });
        return true;
      }
      if (w.count < limit) {
        w.count++;
        return true;
      }
      return false;
    },
  };
}
