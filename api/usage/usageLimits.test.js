"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const limits = require("./usageLimits");

test("defaults apply when nothing is configured", () => {
  const r = limits.resolveLimits({});
  assert.deepEqual(r, {
    maxUserExchanges: 40,
    maxDailyUsage: 300,
    maxMessageChars: 2000,
    maxRequestsPerMinute: 30,
  });
});

test("valid settings override defaults", () => {
  const r = limits.resolveLimits({
    MAX_USER_EXCHANGES: "12",
    MAX_DAILY_USAGE: "50",
    MAX_MESSAGE_CHARS: "500",
    MAX_REQUESTS_PER_MINUTE: "5",
  });
  assert.deepEqual(r, { maxUserExchanges: 12, maxDailyUsage: 50, maxMessageChars: 500, maxRequestsPerMinute: 5 });
});

test("invalid, empty, negative and zero values fall back to the default (never to unlimited)", () => {
  for (const bad of ["", "abc", "-4", "0", "NaN", "Infinity", undefined]) {
    const r = limits.resolveLimits({ MAX_USER_EXCHANGES: bad, MAX_DAILY_USAGE: bad, MAX_MESSAGE_CHARS: bad });
    assert.equal(r.maxUserExchanges, 40, `exchanges for ${bad}`);
    assert.equal(r.maxDailyUsage, 300, `daily for ${bad}`);
    assert.equal(r.maxMessageChars, 2000, `chars for ${bad}`);
  }
});

test("MAX_REQUESTS_PER_MINUTE=0 disables the burst limiter, other bad values use the default", () => {
  assert.equal(limits.resolveLimits({ MAX_REQUESTS_PER_MINUTE: "0" }).maxRequestsPerMinute, 0);
  assert.equal(limits.resolveLimits({ MAX_REQUESTS_PER_MINUTE: "-1" }).maxRequestsPerMinute, 30);
  assert.equal(limits.resolveLimits({ MAX_REQUESTS_PER_MINUTE: "x" }).maxRequestsPerMinute, 30);
});

test("fractional values are floored", () => {
  assert.equal(limits.resolveLimits({ MAX_DAILY_USAGE: "10.9" }).maxDailyUsage, 10);
});
