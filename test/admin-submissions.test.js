import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";
import {
  ADMIN_AUTH,
  createAdminSessionToken,
} from "../src/admin-auth.js";

const surveyId = "123e4567-e89b-42d3-a456-426614174000";
const submissionIds = [
  "987e6543-e21b-42d3-b456-426614174999",
  "887e6543-e21b-42d3-a456-426614174998",
];
const submittedTimes = [
  "2026-10-10T01:00:00.000Z",
  "2026-10-10T02:00:00.000Z",
];
const definition = [
  "question_id,type,label,required,options",
  "comments,textarea,中文意见,false,",
  "rating,single_choice,Rating,true,Good|Poor",
  "features,multi_choice,Features,false,Fast|Clear",
].join("\n");
const authEnv = {
  ADMIN_PASSWORD: "synthetic-admin-password",
  SESSION_SECRET: "synthetic-session-secret-with-at-least-thirty-two-bytes",
};

class FakeR2Bucket {
  constructor({ includeSubmissions = true } = {}) {
    this.objects = new Map();
    this.calls = [];
    this.objects.set(`v1/surveys/${surveyId}/definition.csv`, definition);
    this.objects.set(`v1/surveys/${surveyId}/metadata.json`, JSON.stringify({
      schema_version: 1,
      survey_id: surveyId,
      title: "Feedback export",
      source_filename: "Feedback export.csv",
      created_at: "2026-10-10T00:00:00.000Z",
      status: "active",
    }));
    if (includeSubmissions) {
      this.seedSubmission(0, {
        comments: "Line 1,\n\"quoted\"",
        rating: "Good",
        features: ["Fast", "Clear"],
      });
      this.seedSubmission(1, {
        comments: "",
        rating: "Poor",
        features: [],
      });
    }
  }

  seedSubmission(index, answers) {
    const submission = {
      schema_version: 1,
      submission_id: submissionIds[index],
      survey_id: surveyId,
      survey_schema_version: 1,
      email: `person${index + 1}@example.com`,
      submitted_at: submittedTimes[index],
      answers,
    };
    this.objects.set(
      `v1/submissions/${surveyId}/${submittedTimes[index]}_${submissionIds[index]}.json`,
      JSON.stringify(submission),
    );
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

  async put() {
    throw new Error("Unexpected write");
  }

  async delete(key) {
    this.calls.push({ method: "delete", key });
    this.objects.delete(key);
  }

  async list(options = {}) {
    this.calls.push({ method: "list", options });
    const keys = [...this.objects.keys()]
      .filter((key) => key.startsWith(options.prefix ?? ""))
      .sort();
    const offset = options.cursor === undefined ? 0 : Number(options.cursor);
    const pageSize = Math.min(options.limit ?? 1, 1);
    const page = keys.slice(offset, offset + pageSize);
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

async function authHeaders() {
  const token = await createAdminSessionToken(authEnv);
  return { Cookie: `${ADMIN_AUTH.cookieName}=${token}` };
}

test("rejects unauthenticated submission listing before reading R2", async () => {
  const bucket = new FakeR2Bucket();
  bucket.calls = [];
  const response = await worker.fetch(
    request(`/api/admin/questionnaires/${surveyId}/submissions`),
    { ...authEnv, SURVEY_BUCKET: bucket },
  );
  assert.equal(response.status, 401);
  assert.equal(bucket.calls.length, 0);
});

test("lists submissions with opaque pagination and public summary fields", async () => {
  const bucket = new FakeR2Bucket();
  const headers = await authHeaders();
  const firstResponse = await worker.fetch(
    request(`/api/admin/questionnaires/${surveyId}/submissions`, { headers }),
    { ...authEnv, SURVEY_BUCKET: bucket },
  );
  const first = await firstResponse.json();
  assert.equal(firstResponse.status, 200);
  assert.equal(first.survey.title, "Feedback export");
  assert.deepEqual(first.submissions, [{
    submission_id: submissionIds[0],
    email: "person1@example.com",
    submitted_at: submittedTimes[0],
  }]);
  assert.equal(first.cursor, "1");

  const secondResponse = await worker.fetch(
    request(`/api/admin/questionnaires/${surveyId}/submissions?cursor=1`, { headers }),
    { ...authEnv, SURVEY_BUCKET: bucket },
  );
  const second = await secondResponse.json();
  assert.equal(secondResponse.status, 200);
  assert.equal(second.submissions[0].submission_id, submissionIds[1]);
  assert.equal(second.cursor, null);
  assert.equal(bucket.calls.some(({ method }) => method === "put"), false);
});

test("shows one submission with question labels in definition order", async () => {
  const bucket = new FakeR2Bucket();
  const query = new URLSearchParams({ submitted_at: submittedTimes[0] });
  const response = await worker.fetch(
    request(
      `/api/admin/questionnaires/${surveyId}/submissions/${submissionIds[0]}?${query}`,
      { headers: await authHeaders() },
    ),
    { ...authEnv, SURVEY_BUCKET: bucket },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(
    body.survey.questions.map(({ label }) => label),
    ["中文意见", "Rating", "Features"],
  );
  assert.equal(body.submission.answers.comments, "Line 1,\n\"quoted\"");
  assert.equal(bucket.calls.some(({ method }) => method === "put"), false);
});

test("exports a UTF-8 BOM and escaped CSV in questionnaire order", async () => {
  const bucket = new FakeR2Bucket();
  const response = await worker.fetch(
    request(`/api/admin/questionnaires/${surveyId}/submissions.csv`, {
      headers: await authHeaders(),
    }),
    { ...authEnv, SURVEY_BUCKET: bucket },
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  const csv = new TextDecoder().decode(bytes.slice(3));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/csv; charset=utf-8");
  assert.match(response.headers.get("Content-Disposition"), /attachment/u);
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(
    csv,
    [
      "submission_id,email,submitted_at,comments,rating,features",
      `${submissionIds[0]},person1@example.com,${submittedTimes[0]},"Line 1,\n""quoted""",Good,Fast|Clear`,
      `${submissionIds[1]},person2@example.com,${submittedTimes[1]},,Poor,`,
    ].join("\n"),
  );
});

test("exports a valid header when there are no submissions", async () => {
  const bucket = new FakeR2Bucket({ includeSubmissions: false });
  const response = await worker.fetch(
    request(`/api/admin/questionnaires/${surveyId}/submissions.csv`, {
      headers: await authHeaders(),
    }),
    { ...authEnv, SURVEY_BUCKET: bucket },
  );
  assert.equal(response.status, 200);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(
    new TextDecoder().decode(bytes.slice(3)),
    "submission_id,email,submitted_at,comments,rating,features",
  );
});

test("rejects unauthenticated export and malformed stored submissions safely", async () => {
  const bucket = new FakeR2Bucket();
  const unauthorized = await worker.fetch(
    request(`/api/admin/questionnaires/${surveyId}/submissions.csv`),
    { ...authEnv, SURVEY_BUCKET: bucket },
  );
  assert.equal(unauthorized.status, 401);

  const key = `v1/submissions/${surveyId}/${submittedTimes[0]}_${submissionIds[0]}.json`;
  bucket.objects.set(key, "not-json");
  const malformed = await worker.fetch(
    request(`/api/admin/questionnaires/${surveyId}/submissions`, {
      headers: await authHeaders(),
    }),
    { ...authEnv, SURVEY_BUCKET: bucket },
  );
  assert.equal(malformed.status, 500);
  assert.deepEqual(await malformed.json(), { error: "Submissions unavailable" });
});

test("rejects unauthenticated submission deletion before reading R2", async () => {
  const bucket = new FakeR2Bucket();
  bucket.calls = [];
  const query = new URLSearchParams({ submitted_at: submittedTimes[0] });
  const response = await worker.fetch(
    request(
      `/api/admin/questionnaires/${surveyId}/submissions/${submissionIds[0]}?${query}`,
      { method: "DELETE" },
    ),
    { ...authEnv, SURVEY_BUCKET: bucket },
  );
  assert.equal(response.status, 401);
  assert.equal(bucket.calls.length, 0);
});

test("deletes one submission and leaves the others untouched", async () => {
  const bucket = new FakeR2Bucket();
  const headers = await authHeaders();
  const query = new URLSearchParams({ submitted_at: submittedTimes[0] });
  const response = await worker.fetch(
    request(
      `/api/admin/questionnaires/${surveyId}/submissions/${submissionIds[0]}?${query}`,
      { method: "DELETE", headers },
    ),
    { ...authEnv, SURVEY_BUCKET: bucket },
  );

  assert.equal(response.status, 204);
  assert.equal(
    bucket.objects.has(
      `v1/submissions/${surveyId}/${submittedTimes[0]}_${submissionIds[0]}.json`,
    ),
    false,
  );
  assert.equal(
    bucket.objects.has(
      `v1/submissions/${surveyId}/${submittedTimes[1]}_${submissionIds[1]}.json`,
    ),
    true,
  );
  assert.equal(
    bucket.objects.has(`v1/surveys/${surveyId}/definition.csv`),
    true,
  );
});

test("returns safe errors for missing and malformed submission deletion", async () => {
  const bucket = new FakeR2Bucket({ includeSubmissions: false });
  const headers = await authHeaders();

  const query = new URLSearchParams({ submitted_at: submittedTimes[0] });
  const missing = await worker.fetch(
    request(
      `/api/admin/questionnaires/${surveyId}/submissions/${submissionIds[0]}?${query}`,
      { method: "DELETE", headers },
    ),
    { ...authEnv, SURVEY_BUCKET: bucket },
  );
  assert.equal(missing.status, 404);

  const withoutTimestamp = await worker.fetch(
    request(
      `/api/admin/questionnaires/${surveyId}/submissions/${submissionIds[0]}`,
      { method: "DELETE", headers },
    ),
    { ...authEnv, SURVEY_BUCKET: bucket },
  );
  assert.equal(withoutTimestamp.status, 404);

  const badTimestampQuery = new URLSearchParams({ submitted_at: "not-a-timestamp" });
  const malformed = await worker.fetch(
    request(
      `/api/admin/questionnaires/${surveyId}/submissions/${submissionIds[0]}?${badTimestampQuery}`,
      { method: "DELETE", headers },
    ),
    { ...authEnv, SURVEY_BUCKET: bucket },
  );
  assert.equal(malformed.status, 404);

  const badIdQuery = new URLSearchParams({ submitted_at: submittedTimes[0] });
  const badId = await worker.fetch(
    request(
      `/api/admin/questionnaires/${surveyId}/submissions/not-a-uuid?${badIdQuery}`,
      { method: "DELETE", headers },
    ),
    { ...authEnv, SURVEY_BUCKET: bucket },
  );
  assert.equal(badId.status, 404);

  assert.equal(bucket.calls.filter(({ method }) => method === "delete").length, 0);
});

test("questionnaire becomes deletable again after all submissions are removed", async () => {
  const bucket = new FakeR2Bucket();
  const headers = await authHeaders();

  for (let index = 0; index < submissionIds.length; index += 1) {
    const query = new URLSearchParams({ submitted_at: submittedTimes[index] });
    const response = await worker.fetch(
      request(
        `/api/admin/questionnaires/${surveyId}/submissions/${submissionIds[index]}?${query}`,
        { method: "DELETE", headers },
      ),
      { ...authEnv, SURVEY_BUCKET: bucket },
    );
    assert.equal(response.status, 204);
  }

  const deleteResponse = await worker.fetch(
    request(`/api/admin/questionnaires/${surveyId}`, {
      method: "DELETE",
      headers,
    }),
    { ...authEnv, SURVEY_BUCKET: bucket },
  );
  assert.equal(deleteResponse.status, 204);
  assert.equal(
    bucket.objects.has(`v1/surveys/${surveyId}/definition.csv`),
    false,
  );
  assert.equal(
    bucket.objects.has(`v1/surveys/${surveyId}/metadata.json`),
    false,
  );
});
