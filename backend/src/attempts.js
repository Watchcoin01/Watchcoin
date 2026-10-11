// Per-account limit on wrong guesses (passwords, recovery codes).
// The network-level rate limit in server.js only counts requests per visitor address, so someone using many
// addresses could still keep guessing at one account. This counts failures per account instead.
// It lives in memory, which is fine because the backend runs as a single copy (see README: keep 1 replica).
const { HttpError } = require('./util');

function limiter({ max, windowMs, message }) {
  const hits = new Map(); // key -> { n, until }
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.until <= now) hits.delete(k);
  }, 60 * 1000);
  timer.unref(); // never keeps the process alive

  const live = (key) => {
    const v = hits.get(key);
    if (v && v.until <= Date.now()) { hits.delete(key); return null; }
    return v || null;
  };
  return {
    // Call before checking the secret. Throws 429 while the account is locked.
    check(key) {
      const v = live(key);
      if (v && v.n >= max) {
        throw new HttpError(429, message, { retryAfterSec: Math.ceil((v.until - Date.now()) / 1000) });
      }
    },
    // Call after a wrong guess.
    fail(key) {
      const v = live(key);
      if (v) v.n += 1; else hits.set(key, { n: 1, until: Date.now() + windowMs });
    },
    // Call after a correct guess.
    clear(key) { hits.delete(key); },
    reset() { hits.clear(); },
  };
}

const MIN = 60 * 1000;
module.exports = {
  limiter,
  // 10 wrong passwords per email, then 15 minutes of waiting.
  login: limiter({ max: 10, windowMs: 15 * MIN, message: 'Too many wrong passwords for this account. Try again in a few minutes.' }),
  // Recovery codes are shorter than passwords, so the limit is stricter: 5 wrong codes, then one hour.
  reset: limiter({ max: 5, windowMs: 60 * MIN, message: 'Too many wrong recovery codes for this account. Try again in an hour.' }),
};
