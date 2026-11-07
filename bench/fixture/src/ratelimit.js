// Fixed-window limiter: at most `limit` calls per key per `windowMs`.
export function createLimiter(limit, windowMs) {
  const windows = new Map();
  return {
    allow(key, now = Date.now()) {
      if (typeof key !== "string" || key === "") throw new TypeError("key required");
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
