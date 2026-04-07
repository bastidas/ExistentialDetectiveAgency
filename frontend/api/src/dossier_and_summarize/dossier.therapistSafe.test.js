"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createEmptyDossier, normalizeDossier, buildTherapistSafeDossierSummary } = require("./dossier");

test("buildTherapistSafeDossierSummary: excludes low-confidence inferred entries", () => {
  const d = createEmptyDossier("t1");
  d.inferred.interests = [
    { topic: "reading", confidence: 0.2, evidence: "weak" },
    { topic: "music", confidence: 0.7, evidence: "stated" },
  ];
  const json = JSON.parse(buildTherapistSafeDossierSummary(normalizeDossier(d, "t1")));
  assert.equal(json.inferred.interests.length, 1);
  assert.equal(json.inferred.interests[0].topic, "music");
});

test("buildTherapistSafeDossierSummary: omits device/browser preference traits", () => {
  const d = createEmptyDossier("t2");
  d.inferred.deviceTypePreference = [{ value: "mobile", confidence: 0.9, evidence: "x" }];
  d.inferred.interests = [{ topic: "x", confidence: 0.9, evidence: "y" }];
  const s = buildTherapistSafeDossierSummary(normalizeDossier(d, "t2"));
  assert.ok(!s.includes("deviceTypePreference"));
  assert.ok(s.includes("interests"));
});

test("buildTherapistSafeDossierSummary: keeps explicit fields", () => {
  const d = createEmptyDossier("t3");
  d.explicit.name = "Alex";
  d.explicit.languages = ["en"];
  const json = JSON.parse(buildTherapistSafeDossierSummary(normalizeDossier(d, "t3")));
  assert.equal(json.explicit.name, "Alex");
  assert.deepEqual(json.explicit.languages, ["en"]);
});
