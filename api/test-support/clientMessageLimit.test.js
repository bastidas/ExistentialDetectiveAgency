"use strict";

/**
 * The browser blocks an over-long message before it is sent (web/js/chat/messageLimit.js). Its
 * default has to agree with the server cap and stay well below Azure Table's 32K-character
 * property limit.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const limit = require("../../web/js/chat/messageLimit.js");
const usageLimits = require("../usage/usageLimits");

const AZURE_PROPERTY_LIMIT = 32 * 1024;

test("client default matches the server default and sits far below the Azure property limit", () => {
  assert.equal(limit.DEFAULT_MAX_CHARS, usageLimits.DEFAULT_MAX_MESSAGE_CHARS);
  assert.ok(limit.DEFAULT_MAX_CHARS <= limit.CEILING_CHARS);
  assert.ok(limit.CEILING_CHARS < AZURE_PROPERTY_LIMIT, "ceiling keeps headroom under 32,768");
});

test("a message at the limit passes and one character over is blocked", () => {
  const max = limit.getMax();
  assert.equal(limit.check("a".repeat(max)).ok, true);
  const over = limit.check("a".repeat(max + 1));
  assert.equal(over.ok, false);
  assert.equal(over.over, 1);
});

test("surrounding whitespace is not counted, matching the server trim", () => {
  const max = limit.getMax();
  assert.equal(limit.check("   " + "a".repeat(max) + "\n\n").ok, true);
});

test("the server-reported limit is adopted but can never exceed the ceiling", () => {
  assert.equal(limit.setMax(500), 500);
  assert.equal(limit.check("a".repeat(501)).ok, false);
  assert.equal(limit.setMax(1_000_000), limit.CEILING_CHARS);
  assert.equal(limit.setMax(undefined), limit.DEFAULT_MAX_CHARS);
  assert.equal(limit.setMax(0), limit.DEFAULT_MAX_CHARS);
  assert.equal(limit.setMax("nope"), limit.DEFAULT_MAX_CHARS);
});

test("the user-facing message names the length, the limit and how much to cut", () => {
  limit.setMax(10000);
  const msg = limit.messageFor(limit.check("a".repeat(10341)));
  assert.match(msg, /too long/);
  assert.match(msg, /10,341 characters/);
  assert.match(msg, /limit is 10,000/);
  assert.match(msg, /shorten it by 341 characters/);
  assert.match(limit.messageFor(limit.check("a".repeat(10001))), /by 1 character\./);
});
