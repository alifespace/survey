import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";

const surveyId = "123e4567-e89b-42d3-a456-426614174000";
const definition = [
  "question_id,type,label,required,options",
  "name,text,Your name,true,",
  "rating,single_choice,Rating,true,Good|Poor",
].join("\n");

class FakeR2Bucket {
  constructor() {
    this.objects = new Map([
      [`v1/surveys/${surveyId}/definition.csv`, definition],
      [`v1/surveys/${surveyId}/metadata.json`, JSON.stringify({
        schema_version: 1,
        survey_id: surveyId,
        title: "Public survey",
        source_filename: "Private source.csv",
        created_at: "2026-10-10T00:00:00.000Z",
        status: "active",
      })],
    ]);
    this.calls = [];
  }

  async head(key) {
    this.calls.push({ method: "head", key });
    return this.objects.has(key) ? { key } : null;
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
      async text() {
        return value;
      },
    };
  }

  async put(key, value, options) {
    this.calls.push({ method: "put", key, value, options });
    if (options.onlyIf?.etagDoesNotMatch === "*" && this.objects.has(key)) {
      return null;
    }
    this.objects.set(key, value);
    return { key };
  }

  async list() {
    return { objects: [], truncated: false };
  }
}

function request(path, options = {}) {
  return new Request(`https://survey.example${path}`, options);
}

test("returns a public questionnaire definition in CSV row order", async () => {
  const bucket = new FakeR2Bucket();
  const response = await worker.fetch(
    request(`/api/questionnaires/${surveyId}`),
    { SURVEY_BUCKET: bucket },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    survey: {
      survey_id: surveyId,
      title: "Public survey",
      questions: [
        {
          question_id: "name",
          type: "text",
          label: "Your name",
          required: true,
          options: [],
        },
        {
          question_id: "rating",
          type: "single_choice",
          label: "Rating",
          required: true,
          options: ["Good", "Poor"],
        },
      ],
    },
  });
  assert.equal(JSON.stringify(body).includes("source_filename"), false);
});

test("rejects invalid and unavailable questionnaire identifiers", async () => {
  const bucket = new FakeR2Bucket();
  const invalidResponse = await worker.fetch(
    request("/api/questionnaires/invalid"),
    { SURVEY_BUCKET: bucket },
  );
  const missingResponse = await worker.fetch(
    request("/api/questionnaires/223e4567-e89b-42d3-a456-426614174000"),
    { SURVEY_BUCKET: bucket },
  );

  assert.equal(invalidResponse.status, 404);
  assert.equal(missingResponse.status, 404);
});

test("stores a submission through the public API without returning private data", async () => {
  const bucket = new FakeR2Bucket();
  const response = await worker.fetch(
    request(`/api/questionnaires/${surveyId}/submissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "person@example.com",
        answers: { name: "Person", rating: "Good" },
      }),
    }),
    { SURVEY_BUCKET: bucket },
  );
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.match(body.submission.submission_id, /^[0-9a-f-]{36}$/u);
  assert.match(body.submission.submitted_at, /Z$/u);
  assert.equal(JSON.stringify(body).includes("person@example.com"), false);
  assert.equal(bucket.calls.filter(({ method }) => method === "put").length, 1);
});

test("rejects invalid submission bodies without writing", async () => {
  const bucket = new FakeR2Bucket();
  const response = await worker.fetch(
    request(`/api/questionnaires/${surveyId}/submissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "invalid",
        answers: { name: "Person", rating: "Good" },
      }),
    }),
    { SURVEY_BUCKET: bucket },
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "INVALID_EMAIL");
  assert.equal(bucket.calls.some(({ method }) => method === "put"), false);
});
