"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { userHasPersistedDossier } = require("./dossierPresence");
const { createEmptyDossier } = require("./dossier");

test("userHasPersistedDossier: false for null / empty row", () => {
  assert.equal(userHasPersistedDossier(null), false);
  assert.equal(userHasPersistedDossier(undefined), false);
  assert.equal(userHasPersistedDossier({}), false);
  assert.equal(userHasPersistedDossier(createEmptyDossier("u1")), false);
});

test("userHasPersistedDossier: true when baseline completed or answered or inferred content", () => {
  assert.equal(
    userHasPersistedDossier({
      meta: { lastBaselineCompletedAt: Date.now() },
    }),
    true
  );
  assert.equal(
    userHasPersistedDossier({
      meta: { baselineQuestionsAnswered: 1 },
    }),
    true
  );
  assert.equal(
    userHasPersistedDossier({
      inferred: { interests: [{ value: "x", likelihood: "low" }] },
    }),
    true
  );
  assert.equal(
    userHasPersistedDossier({
      explicit: { name: "Ada", preferredPronouns: null, languages: [] },
    }),
    true
  );
});
