import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";
import { ADMIN_AUTH } from "../src/admin-auth.js";

const envConfig = {
  ADMIN_PASSWORD: "synthetic-admin-password",
  SESSION_SECRET: "synthetic-session-secret-with-at-least-thirty-two-bytes",
};

class FakeR2Bucket {
  constructor() {
    this.objects = new Map();
  }

  async head(key) {
    return this.objects.has(key) ? { key } : null;
  }

  async get(key) {
    const stored = this.objects.get(key);
    if (stored === undefined) {
      return null;
    }
    return {
      async json() {
        return JSON.parse(stored.value);
      },
      async text() {
        return stored.value;
      },
    };
  }

  async put(key, value, options = {}) {
    if (options.onlyIf?.etagDoesNotMatch === "*" && this.objects.has(key)) {
      return null;
    }
    this.objects.set(key, { value, options });
    return { key };
  }

  async list(options = {}) {
    const keys = [...this.objects.keys()]
      .filter((key) => key.startsWith(options.prefix ?? ""))
      .sort();
    const offset = options.cursor === undefined ? 0 : Number(options.cursor);
    const page = keys.slice(offset, offset + options.limit);
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

test("completes the synthetic local survey workflow and its failure paths", async () => {
  const bucket = new FakeR2Bucket();
  const env = { ...envConfig, SURVEY_BUCKET: bucket };

  const invalidLogin = await worker.fetch(
    request("/api/admin/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "wrong-password" }),
    }),
    env,
  );
  assert.equal(invalidLogin.status, 401);

  const login = await worker.fetch(
    request("/api/admin/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: envConfig.ADMIN_PASSWORD }),
    }),
    env,
  );
  assert.equal(login.status, 204);
  const cookie = login.headers.get("Set-Cookie").split(";", 1)[0];
  assert.match(cookie, new RegExp(`^${ADMIN_AUTH.cookieName}=`));
  const adminHeaders = { Cookie: cookie };

  const csv = [
    "question_id,type,label,required,options",
    "name,text,Name,true,",
    "rating,single_choice,Rating,true,Good|Poor",
  ].join("\n");
  const upload = new FormData();
  upload.append("file", new Blob([csv], { type: "text/csv" }), "E2E Survey.csv");
  const uploadResponse = await worker.fetch(
    request("/api/admin/questionnaires", {
      method: "POST",
      headers: adminHeaders,
      body: upload,
    }),
    env,
  );
  assert.equal(uploadResponse.status, 201);
  const { survey } = await uploadResponse.json();

  const publicList = await worker.fetch(request("/api/questionnaires"), env);
  assert.equal(publicList.status, 200);
  assert.equal((await publicList.json()).surveys[0].survey_id, survey.survey_id);

  const publicSurvey = await worker.fetch(
    request(`/api/questionnaires/${survey.survey_id}`),
    env,
  );
  assert.equal(publicSurvey.status, 200);
  assert.equal((await publicSurvey.json()).survey.questions.length, 2);

  const submissionPrefix = `v1/submissions/${survey.survey_id}/`;
  const invalidSubmission = await worker.fetch(
    request(`/api/questionnaires/${survey.survey_id}/submissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "person@example.com",
        answers: { name: "Person", rating: "Unknown" },
      }),
    }),
    env,
  );
  assert.equal(invalidSubmission.status, 400);
  assert.equal(
    [...bucket.objects.keys()].filter((key) => key.startsWith(submissionPrefix)).length,
    0,
  );

  const unavailable = await worker.fetch(
    request("/api/questionnaires/223e4567-e89b-42d3-a456-426614174000/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "person@example.com", answers: {} }),
    }),
    env,
  );
  assert.equal(unavailable.status, 404);

  const submitResponse = await worker.fetch(
    request(`/api/questionnaires/${survey.survey_id}/submissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "person@example.com",
        answers: { name: "Person", rating: "Good" },
      }),
    }),
    env,
  );
  assert.equal(submitResponse.status, 201);
  const { submission } = await submitResponse.json();

  const adminList = await worker.fetch(
    request(`/api/admin/questionnaires/${survey.survey_id}/submissions`, {
      headers: adminHeaders,
    }),
    env,
  );
  assert.equal(adminList.status, 200);
  const listedSubmission = (await adminList.json()).submissions[0];
  assert.equal(listedSubmission.submission_id, submission.submission_id);

  const detailQuery = new URLSearchParams({ submitted_at: listedSubmission.submitted_at });
  const detail = await worker.fetch(
    request(
      `/api/admin/questionnaires/${survey.survey_id}/submissions/${submission.submission_id}?${detailQuery}`,
      { headers: adminHeaders },
    ),
    env,
  );
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).submission.answers.rating, "Good");

  const exportResponse = await worker.fetch(
    request(`/api/admin/questionnaires/${survey.survey_id}/submissions.csv`, {
      headers: adminHeaders,
    }),
    env,
  );
  assert.equal(exportResponse.status, 200);
  const exported = await exportResponse.text();
  assert.match(exported, /^submission_id,email,submitted_at,name,rating\n/u);
  assert.match(exported, /person@example\.com/u);
});
