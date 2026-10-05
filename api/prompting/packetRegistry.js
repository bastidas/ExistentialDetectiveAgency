"use strict";

/**
 * Allowlisted packet fields per agent, in canonical key order.
 * Empty optionals are omitted (never sent as null or "").
 */

const PACKET_VERSION = 1;

const PACKET_FIELDS = Object.freeze({
  lumen: Object.freeze([
    "packet_version",
    "narrative_phase",
    "dossier_summary",
    "secrets_revealed",
    "summary",
  ]),
  umbra: Object.freeze([
    "packet_version",
    "narrative_phase",
    "dossier_summary",
    "secrets_revealed",
    "summary",
  ]),
});

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isEmptyOptional(value) {
  if (value == null) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  return false;
}

/**
 * @param {string} agentKey
 * @param {Record<string, unknown>} [facts]
 * @returns {Record<string, unknown>}
 */
function buildAgentUserPacket(agentKey, facts) {
  const src = facts && typeof facts === "object" ? facts : {};
  const keys = PACKET_FIELDS[agentKey];
  if (!keys) {
    return { packet_version: PACKET_VERSION };
  }
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const key of keys) {
    if (key === "packet_version") {
      out.packet_version = PACKET_VERSION;
      continue;
    }
    let value = src[key];
    if (key === "summary" && isEmptyOptional(value)) {
      value = src.preceding_conversation_summary;
    }
    if (isEmptyOptional(value)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Stable JSON: registry key order, compact.
 * @param {Record<string, unknown>} packet
 * @param {string} [agentKey]
 * @returns {string}
 */
function stringifyPacket(packet, agentKey) {
  const keys = (agentKey && PACKET_FIELDS[agentKey]) || Object.keys(packet);
  /** @type {Record<string, unknown>} */
  const ordered = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(packet, key)) {
      ordered[key] = packet[key];
    }
  }
  return JSON.stringify(ordered);
}

module.exports = {
  PACKET_VERSION,
  PACKET_FIELDS,
  buildAgentUserPacket,
  stringifyPacket,
};
