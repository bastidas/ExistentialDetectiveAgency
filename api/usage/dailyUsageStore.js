"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Daily budget counters. A "turn" is one LLM-backed user message. All stores share one interface:
 *
 *   readDailyUsage()   -> number | Promise<number>   turns used today (UTC)
 *   reserveTurn(max)   -> { allowed, count } | Promise<...>   count a turn if under `max`
 *
 * Memory: per process. File: one JSON file, for local dev. Table: Azure Table Storage with ETag
 * concurrency, shared by every instance; if storage fails it falls back to a per-process counter so
 * a storage outage neither takes the site down nor removes the cap.
 */

/** @param {number} [nowMs] */
function utcDayKey(nowMs = Date.now()) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** @param {{ now?: () => number }} [opts] */
function createMemoryDailyUsageStore(opts = {}) {
  const now = opts.now || Date.now;
  let day = utcDayKey(now());
  let count = 0;
  function roll() {
    const d = utcDayKey(now());
    if (d !== day) {
      day = d;
      count = 0;
    }
  }
  return {
    kind: "memory",
    readDailyUsage() {
      roll();
      return count;
    },
    reserveTurn(max) {
      roll();
      if (count >= max) return { allowed: false, count };
      count += 1;
      return { allowed: true, count };
    },
  };
}

/**
 * @param {string} dataDir
 * @param {{ now?: () => number }} [opts]
 */
function createFileDailyUsageStore(dataDir, opts = {}) {
  const now = opts.now || Date.now;
  const filePath = path.join(dataDir, "daily_usage.json");
  function read() {
    try {
      const j = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (j && j.date === utcDayKey(now()) && typeof j.count === "number") return j.count;
    } catch (_) {
      /* missing or unreadable: counts as zero */
    }
    return 0;
  }
  return {
    kind: "file",
    readDailyUsage: read,
    reserveTurn(max) {
      const count = read();
      if (count >= max) return { allowed: false, count };
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify({ date: utcDayKey(now()), count: count + 1 }));
      return { allowed: true, count: count + 1 };
    },
  };
}

const MAX_TABLE_ATTEMPTS = 12;

function backoff(attempt) {
  return new Promise((resolve) => setTimeout(resolve, Math.random() * 10 * (attempt + 1)));
}

/**
 * @param {import("@azure/data-tables").TableClient} client
 * @param {{ now?: () => number, fallback?: ReturnType<typeof createMemoryDailyUsageStore>, onError?: (err: unknown) => void }} [opts]
 */
function createTableDailyUsageStore(client, opts = {}) {
  const now = opts.now || Date.now;
  const fallback = opts.fallback || createMemoryDailyUsageStore({ now });
  const onError = opts.onError || ((err) => console.warn("[dailyUsage] table store failed, using memory:", err && err.message));
  const storage = require("../storage/durableTableStorage");
  const partitionKey = storage.PK.usageDaily;

  async function readEntity(rowKey) {
    await storage.ensureTable(client);
    return storage.getEntity(client, partitionKey, rowKey);
  }

  return {
    kind: "table",
    async readDailyUsage() {
      try {
        const entity = await readEntity(utcDayKey(now()));
        return entity ? Number(entity.count || 0) : 0;
      } catch (err) {
        onError(err);
        return fallback.readDailyUsage();
      }
    },
    async reserveTurn(max) {
      const rowKey = utcDayKey(now());
      try {
        for (let attempt = 0; attempt < MAX_TABLE_ATTEMPTS; attempt += 1) {
          const entity = await readEntity(rowKey);
          const updatedAt = new Date(now()).toISOString();
          if (!entity) {
            try {
              await client.createEntity({ partitionKey, rowKey, count: 1, updatedAt });
              return { allowed: true, count: 1 };
            } catch (err) {
              if (err && err.statusCode === 409) {
                await backoff(attempt);
                continue;
              }
              throw err;
            }
          }
          const count = Number(entity.count || 0);
          if (count >= max) return { allowed: false, count };
          try {
            await client.updateEntity(
              { partitionKey, rowKey, count: count + 1, updatedAt },
              "Replace",
              { etag: entity.etag }
            );
            return { allowed: true, count: count + 1 };
          } catch (err) {
            if (err && (err.statusCode === 412 || err.statusCode === 409)) {
              await backoff(attempt);
              continue;
            }
            throw err;
          }
        }
        throw new Error("daily usage counter contention");
      } catch (err) {
        onError(err);
        return fallback.reserveTurn(max);
      }
    },
  };
}

/**
 * Pick the store for the current configuration: Table Storage when durable storage is on and
 * configured, else a file in `dataDir` (local dev), else memory.
 *
 * @param {{ dataDir?: string, now?: () => number }} [opts]
 */
function createDailyUsageStore(opts = {}) {
  const config = require("../config");
  if (config.resolveDurableStorageMode() !== "off") {
    const client = require("../storage/durableTableStorage").getTableClient();
    if (client) return createTableDailyUsageStore(client, { now: opts.now });
  }
  if (opts.dataDir) return createFileDailyUsageStore(opts.dataDir, { now: opts.now });
  return createMemoryDailyUsageStore({ now: opts.now });
}

module.exports = {
  utcDayKey,
  createMemoryDailyUsageStore,
  createFileDailyUsageStore,
  createTableDailyUsageStore,
  createDailyUsageStore,
};
