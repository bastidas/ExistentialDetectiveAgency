"use strict";

/** With no limit settings at all the API is still bounded (no more "1,000,000" defaults). */

delete process.env.MAX_USER_EXCHANGES;
delete process.env.MAX_DAILY_USAGE;
delete process.env.MAX_MESSAGE_CHARS;
delete process.env.MAX_REQUESTS_PER_MINUTE;

require("./noDurable");
const test = require("node:test");
const assert = require("node:assert/strict");
const shared = require("../shared");

test("shared.js applies the default limits when nothing is configured", () => {
  assert.equal(shared.MAX_USER_EXCHANGES, 40);
  assert.equal(shared.MAX_DAILY_USAGE, 300);
  assert.equal(shared.MAX_MESSAGE_CHARS, 2000);
});
