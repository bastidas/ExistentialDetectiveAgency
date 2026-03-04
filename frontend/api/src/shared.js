"use strict";

const crypto = require("crypto");
const chatShared = require("../shared");

function parseCookieHeader(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  cookieHeader.split(";").forEach((part) => {
    const [key, ...v] = part.trim().split("=");
    if (key) out[key.trim()] = decodeURIComponent((v.join("=") || "").trim());
  });
  return out;
}

function getOrCreateSessionId(request) {
  const cookieHeader = request.headers.get("cookie");
  const cookies = parseCookieHeader(cookieHeader);
  let sessionId = cookies.sessionId;
  if (!sessionId) {
    sessionId = crypto.randomUUID();
  }
  return sessionId;
}

function sessionCookieHeader(sessionId) {
  const value = encodeURIComponent(sessionId);
  return `sessionId=${value}; Path=/; HttpOnly; Max-Age=604800; SameSite=Lax`;
}

module.exports = {
  ...chatShared,
  parseCookieHeader,
  getOrCreateSessionId,
  sessionCookieHeader,
};
