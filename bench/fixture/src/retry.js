const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry an async fn up to `retries` extra times with a fixed delay.
export async function retry(fn, { retries = 2, delayMs = 10 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(delayMs);
    }
  }
  throw lastErr;
}
