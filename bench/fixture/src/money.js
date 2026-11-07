// Parse a user-entered amount like "12.34" or "$5" into integer cents.
export function parseAmount(input) {
  if (typeof input !== "string") throw new TypeError("amount must be a string");
  const s = input.replace(/^\$/, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`invalid amount: ${input}`);
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return s.startsWith("-") ? -cents : cents;
}

// Format integer cents as "$1,234.56".
export function formatCents(cents) {
  if (!Number.isInteger(cents)) throw new TypeError("cents must be an integer");
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${whole}.${String(abs % 100).padStart(2, "0")}`;
}

export function addCents(...values) {
  return values.reduce((a, b) => a + b, 0);
}

// Deprecated: kept for v0 callers.
export function toDollars(cents) {
  return cents / 100;
}
