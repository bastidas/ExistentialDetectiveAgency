"use strict";

const path = require("node:path");

function createMemoryTableClient() {
  const rows = new Map();
  const key = (pk, rk) => `${pk}\u0000${rk}`;
  return {
    rows,
    async createTable() {},
    async getEntity(pk, rk) {
      const found = rows.get(key(pk, rk));
      if (!found) {
        const err = new Error("not found");
        err.statusCode = 404;
        throw err;
      }
      return JSON.parse(JSON.stringify(found));
    },
    async upsertEntity(entity) {
      rows.set(key(entity.partitionKey, entity.rowKey), JSON.parse(JSON.stringify(entity)));
    },
    async *listEntities(opts) {
      const filter = String(opts && opts.queryOptions && opts.queryOptions.filter);
      const m = /PartitionKey eq '(.*)'$/.exec(filter);
      const pk = m ? m[1].replace(/''/g, "'") : null;
      for (const row of rows.values()) {
        if (pk == null || row.partitionKey === pk) yield JSON.parse(JSON.stringify(row));
      }
    },
  };
}

function freshServer() {
  const apiDir = path.resolve(__dirname, "..");
  for (const k of Object.keys(require.cache)) {
    if (
      k.startsWith(apiDir + path.sep) &&
      !k.includes(`${path.sep}node_modules${path.sep}`) &&
      !k.includes(`${path.sep}test-support${path.sep}`) &&
      !k.endsWith(`${path.sep}durableTableStorage.js`)
    ) {
      delete require.cache[k];
    }
  }
  return require("../shared");
}

module.exports = { createMemoryTableClient, freshServer };
