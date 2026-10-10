import assert from "node:assert/strict";
import test from "node:test";

import {
  submissionKey,
  submissionListPrefix,
  surveyDefinitionKey,
  surveyListPrefix,
  surveyMetadataKey,
} from "../src/object-keys.js";

const surveyId = "123e4567-e89b-42d3-a456-426614174000";
const submissionId = "987e6543-e21b-42d3-b456-426614174999";
const submittedAt = "2026-10-10T00:00:00.000Z";

test("builds survey object keys", () => {
  assert.equal(surveyListPrefix(), "v1/surveys/");
  assert.equal(
    surveyDefinitionKey(surveyId),
    `v1/surveys/${surveyId}/definition.csv`,
  );
  assert.equal(
    surveyMetadataKey(surveyId),
    `v1/surveys/${surveyId}/metadata.json`,
  );
});

test("builds a submission object key", () => {
  assert.equal(
    submissionListPrefix(surveyId),
    `v1/submissions/${surveyId}/`,
  );
  assert.equal(
    submissionKey(surveyId, submittedAt, submissionId),
    `v1/submissions/${surveyId}/${submittedAt}_${submissionId}.json`,
  );
});

const invalidSurveyIdentifiers = [
  ["empty", ""],
  ["path traversal", "../123e4567-e89b-42d3-a456-426614174000"],
  ["slash", "123e4567-e89b-42d3-a456-426614174000/child"],
  ["uppercase", "123E4567-E89B-42D3-A456-426614174000"],
  ["wrong UUID version", "123e4567-e89b-12d3-a456-426614174000"],
  ["wrong UUID variant", "123e4567-e89b-42d3-7456-426614174000"],
  ["non-string", 123],
];

for (const [description, value] of invalidSurveyIdentifiers) {
  test(`rejects an invalid survey identifier: ${description}`, () => {
    assert.throws(() => surveyDefinitionKey(value), {
      name: "TypeError",
      message: "surveyId must be a lowercase UUID v4",
    });
  });
}

test("rejects an invalid submission identifier", () => {
  assert.throws(
    () => submissionKey(surveyId, submittedAt, "../../submission.json"),
    {
      name: "TypeError",
      message: "submissionId must be a lowercase UUID v4",
    },
  );
});

const invalidSubmissionTimestamps = [
  ["offset timestamp", "2026-10-10T08:00:00.000+08:00"],
  ["missing milliseconds", "2026-10-10T00:00:00Z"],
  ["invalid date", "2026-02-30T00:00:00.000Z"],
  ["path separator", "2026-10-10/00:00:00.000Z"],
];

for (const [description, value] of invalidSubmissionTimestamps) {
  test(`rejects an invalid submission timestamp: ${description}`, () => {
    assert.throws(() => submissionKey(surveyId, value, submissionId), {
      name: "TypeError",
      message: "submittedAt must be a canonical UTC ISO-8601 timestamp",
    });
  });
}
