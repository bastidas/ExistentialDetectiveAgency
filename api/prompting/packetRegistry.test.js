"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAgentUserPacket, stringifyPacket } = require("./packetRegistry");
const { formatUserChannelMessage } = require("./userChannel");
const { composeStaticSystemPrompt } = require("./promptComposer");

test("buildAgentUserPacket lumen: version plus non-empty flags, omits empties", () => {
  const packet = buildAgentUserPacket("lumen", {
    narrative_phase: "Exposition",
    dossier_summary: "tired clerk",
    secrets_revealed: "",
    summary: "",
  });
  assert.deepEqual(packet, {
    packet_version: 1,
    narrative_phase: "Exposition",
    dossier_summary: "tired clerk",
  });
});

test("formatUserChannelMessage: JSON then QUERENT then raw text", () => {
  const packet = buildAgentUserPacket("umbra", { narrative_phase: "Rising" });
  const msg = formatUserChannelMessage(packet, "hello there", "umbra");
  assert.match(msg, /^\s*\{[\s\S]*\}\s*\n\n---QUERENT---\nhello there$/);
  assert.ok(!msg.includes("hello there\","));
});

test("composeStaticSystemPrompt is identical across session facts", () => {
  const a = composeStaticSystemPrompt("lumen").content;
  const b = composeStaticSystemPrompt("lumen").content;
  const c = composeStaticSystemPrompt("umbra").content;
  const d = composeStaticSystemPrompt("umbra").content;
  assert.equal(a, b);
  assert.equal(c, d);
  assert.notEqual(a, c);
  assert.ok(!/\[mock custom/i.test(a));
  assert.ok(!/# TURN INSTRUCTIONS/.test(a));
});

test("stringifyPacket uses registry key order", () => {
  const raw = { summary: "s", packet_version: 1, narrative_phase: "N" };
  const json = stringifyPacket(raw, "lumen");
  assert.equal(json.indexOf("packet_version") < json.indexOf("narrative_phase"), true);
  assert.equal(json.indexOf("narrative_phase") < json.indexOf("summary"), true);
});
