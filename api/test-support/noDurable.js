"use strict";

/**
 * Require this first in harness tests that must not touch Azure Table Storage, even when CI exports
 * the Azurite settings for the storage tests. (`shared.js` reads the storage mode per request.)
 */
process.env.DURABLE_STORAGE_MODE = "off";
