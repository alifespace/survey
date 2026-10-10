import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";

const surveyIds = [
  "123e4567-e89b-42d3-a456-426614174000",
  "223e4567-e89b-42d3-a456-426614174000",
];

class FakeR2Bucket {
  constructor() {
    this.objects = new Map();
    this.calls = [];
  }

  seedSurvey(surveyId, title) {
    const key = `v1/surveys/${surveyId}/metadata.json`;
    this.objects.set(key, JSON.stringify({
      schema_version: 1,
      survey_id: surveyId,
      title,
      source_filename: `${title}.csv`,
      created_at: "2026-10-10T00:00:00.000Z",
      status: "active",
    }));
  }

  async head() {
    return null;
  }

  async put() {
    throw new Error("Unexpected write");
  }

  async get(key) {
    this.calls.push({ method: "get", key });
    const value = this.objects.get(key);
    if (value === undefined) {
      return null;
    }
    return {
      async json() {
        return JSON.parse(value);
      },
    };
  }

  async list(options) {
    this.calls.push({ method: "list", options });
    const keys = [...this.objects.keys()].sort();
    const offset = options.cursor === undefined ? 0 : Number(options.cursor);
    const page = keys.slice(offset, offset + 1);
    const nextOffset = offset + page.length;
    const truncated = nextOffset < keys.length;
    return {
      objects: page.map((key) => ({ key })),
      truncated,
      cursor: truncated ? String(nextOffset) : undefined,
    };
  }
}

function request(path, options = {}) {
  return new Request(`https://survey.example${path}`, options);
}

test("lists only public fields for active questionnaires with pagination", async () => {
  const bucket = new FakeR2Bucket();
  bucket.seedSurvey(surveyIds[0], "First survey");
  bucket.seedSurvey(surveyIds[1], "Second survey");

  const firstResponse = await worker.fetch(
    request("/api/questionnaires"),
    { SURVEY_BUCKET: bucket },
  );
  assert.equal(firstResponse.status, 200);
  assert.deepEqual(await firstResponse.json(), {
    surveys: [{ survey_id: surveyIds[0], title: "First survey" }],
    cursor: "1",
  });

  const secondResponse = await worker.fetch(
    request("/api/questionnaires?cursor=1"),
    { SURVEY_BUCKET: bucket },
  );
  assert.equal(secondResponse.status, 200);
  assert.deepEqual(await secondResponse.json(), {
    surveys: [{ survey_id: surveyIds[1], title: "Second survey" }],
    cursor: null,
  });
  assert.equal(bucket.calls.some(({ method }) => method === "put"), false);
});

test("rejects invalid cursors and unsupported methods", async () => {
  const bucket = new FakeR2Bucket();
  const cursorResponse = await worker.fetch(
    request("/api/questionnaires?cursor="),
    { SURVEY_BUCKET: bucket },
  );
  assert.equal(cursorResponse.status, 400);
  assert.deepEqual(await cursorResponse.json(), {
    error: "Invalid cursor",
    code: "INVALID_CURSOR",
  });

  const methodResponse = await worker.fetch(
    request("/api/questionnaires", { method: "POST" }),
    { SURVEY_BUCKET: bucket },
  );
  assert.equal(methodResponse.status, 405);
  assert.equal(methodResponse.headers.get("Allow"), "GET");
});

test("returns a safe error when questionnaire storage is unavailable", async () => {
  const response = await worker.fetch(
    request("/api/questionnaires"),
    { SURVEY_BUCKET: null },
  );
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Questionnaires unavailable",
  });
});
