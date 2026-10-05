"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createRateLimiter, clientKeyFromHeaders } = require("./rateLimiter");

test("allows up to max per window, then blocks with a retry hint", () => {
  let t = 1_000_000;
  const rl = createRateLimiter({ max: 3, windowMs: 60_000, now: () => t });
  assert.ok(rl.check("a").allowed);
  t += 1000;
  assert.ok(rl.check("a").allowed);
  t += 1000;
  assert.ok(rl.check("a").allowed);
  t += 1000;
  const blocked = rl.check("a");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 60_000 - 3000);
});

test("the window slides: old hits expire", () => {
  let t = 0;
  const rl = createRateLimiter({ max: 2, windowMs: 1000, now: () => t });
  rl.check("a");
  rl.check("a");
  assert.equal(rl.check("a").allowed, false);
  t = 1001;
  assert.equal(rl.check("a").allowed, true);
});

test("keys are independent", () => {
  const rl = createRateLimiter({ max: 1, windowMs: 1000, now: () => 0 });
  assert.ok(rl.check("a").allowed);
  assert.ok(rl.check("b").allowed);
  assert.equal(rl.check("a").allowed, false);
});

test("blocked attempts do not extend the block", () => {
  let t = 0;
  const rl = createRateLimiter({ max: 1, windowMs: 1000, now: () => t });
  rl.check("a");
  for (t = 100; t < 900; t += 100) assert.equal(rl.check("a").allowed, false);
  t = 1001;
  assert.equal(rl.check("a").allowed, true);
});

test("max 0 or a missing key means no limiting", () => {
  assert.ok(createRateLimiter({ max: 0 }).check("a").allowed);
  assert.ok(createRateLimiter({ max: 1 }).check("").allowed);
});

test("memory is bounded by maxKeys", () => {
  const rl = createRateLimiter({ max: 5, maxKeys: 100, now: () => 0 });
  for (let i = 0; i < 1000; i += 1) rl.check(`ip-${i}`);
  assert.ok(rl.size() <= 100);
});

test("clientKeyFromHeaders: platform IP, first forwarded hop, ports and brackets stripped, fallback", () => {
  const h = (map) => (name) => map[name];
  assert.equal(clientKeyFromHeaders(h({ "x-azure-clientip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" })), "1.2.3.4");
  assert.equal(clientKeyFromHeaders(h({ "x-forwarded-for": "5.6.7.8, 10.0.0.1" })), "5.6.7.8");
  assert.equal(clientKeyFromHeaders(h({ "x-forwarded-for": "5.6.7.8:4711" })), "5.6.7.8");
  assert.equal(clientKeyFromHeaders(h({ "x-forwarded-for": "[2001:db8::1]:443" })), "2001:db8::1");
  assert.equal(clientKeyFromHeaders(h({}), "127.0.0.1"), "127.0.0.1");
  assert.equal(clientKeyFromHeaders(h({})), "");
});
