import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";
import { ADMIN_AUTH, createAdminSessionToken } from "../src/admin-auth.js";
import { parseQuestionnaireCsv } from "../src/questionnaire-csv.js";

const authEnv = {
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

  async delete(key) {
    this.objects.delete(key);
  }

  async list(options = {}) {
    const keys = [...this.objects.keys()]
      .filter((key) => key.startsWith(options.prefix ?? ""))
      .sort();
    const offset = options.cursor === undefined ? 0 : Number(options.cursor);
    const page = keys.slice(offset, offset + (options.limit ?? 1));
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

async function adminHeaders() {
  const token = await createAdminSessionToken(authEnv);
  return { Cookie: `${ADMIN_AUTH.cookieName}=${token}` };
}

async function createManual(bucket, headers, title, questions) {
  const response = await worker.fetch(
    request("/api/admin/questionnaires", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ title, questions }),
    }),
    { ...authEnv, SURVEY_BUCKET: bucket },
  );
  assert.equal(response.status, 201);
  return (await response.json()).survey;
}

test("1.1 e2e: manual create without IDs, customer submission, and canonical storage", async () => {
  const bucket = new FakeR2Bucket();
  const env = { ...authEnv, SURVEY_BUCKET: bucket };
  const headers = await adminHeaders();

  const created = await createManual(bucket, headers, "No ID Survey", [
    { type: "text", label: "Name", required: true, options: [] },
    { type: "single_choice", label: "Score", required: true, options: ["Good", "Bad"] },
  ]);

  const storedCsv = bucket.objects.get(
    `v1/surveys/${created.survey_id}/definition.csv`,
  ).value;
  assert.deepEqual(
    parseQuestionnaireCsv(storedCsv).questions.map((question) => question.question_id),
    ["q1", "q2"],
  );

  const publicSurvey = await worker.fetch(
    request(`/api/questionnaires/${created.survey_id}`),
    env,
  );
  assert.equal(publicSurvey.status, 200);

  const submit = await worker.fetch(
    request(`/api/questionnaires/${created.survey_id}/submissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "person@example.com",
        answers: { q1: "Person", q2: "Good" },
      }),
    }),
    env,
  );
  assert.equal(submit.status, 201);

  const blocked = await worker.fetch(
    request(`/api/admin/questionnaires/${created.survey_id}`, {
      method: "DELETE",
      headers,
    }),
    env,
  );
  assert.equal(blocked.status, 409);
});

test("1.1 e2e: CSV upload with blank and mixed question IDs", async () => {
  const bucket = new FakeR2Bucket();
  const env = { ...authEnv, SURVEY_BUCKET: bucket };
  const headers = await adminHeaders();

  const body = new FormData();
  body.append(
    "file",
    new Blob([
      [
        "question_id,type,label,required,options",
        ",text,Generated,true,",
        "kept_id,text,Kept,false,",
        ",number,Also generated,false,",
      ].join("\n"),
    ], { type: "text/csv" }),
    "Mixed IDs.csv",
  );
  const response = await worker.fetch(
    request("/api/admin/questionnaires", {
      method: "POST",
      headers,
      body,
    }),
    env,
  );
  assert.equal(response.status, 201);
  const { survey } = await response.json();

  const storedCsv = bucket.objects.get(
    `v1/surveys/${survey.survey_id}/definition.csv`,
  ).value;
  const ids = parseQuestionnaireCsv(storedCsv).questions.map(
    (question) => question.question_id,
  );
  assert.equal(ids[1], "kept_id");
  assert.equal(ids[0], "q1");
  assert.notEqual(ids[2], "kept_id");
  assert.equal(new Set(ids).size, 3);
});

test("1.1 e2e: copy creates an independent survey and leaves the source intact", async () => {
  const bucket = new FakeR2Bucket();
  const env = { ...authEnv, SURVEY_BUCKET: bucket };
  const headers = await adminHeaders();

  const source = await createManual(bucket, headers, "Copy Source", [
    { type: "text", label: "Original question", required: false, options: [] },
  ]);
  const sourceCsv = bucket.objects.get(
    `v1/surveys/${source.survey_id}/definition.csv`,
  ).value;

  const detailResponse = await worker.fetch(
    request(`/api/admin/questionnaires/${source.survey_id}`, { headers }),
    env,
  );
  const { survey: loaded } = await detailResponse.json();

  const copyResponse = await worker.fetch(
    request("/api/admin/questionnaires", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Copied survey",
        questions: loaded.questions.map((question) => ({
          type: question.type,
          label: `${question.label} (copy)`,
          required: question.required,
          options: question.options,
        })),
      }),
    }),
    env,
  );
  assert.equal(copyResponse.status, 201);
  const copy = (await copyResponse.json()).survey;

  assert.notEqual(copy.survey_id, source.survey_id);
  assert.equal(
    bucket.objects.get(`v1/surveys/${source.survey_id}/definition.csv`).value,
    sourceCsv,
  );
  assert.equal(copy.title, "Copied survey");
  assert.equal(
    [...bucket.objects.keys()].filter((key) =>
      key.startsWith(`v1/submissions/${copy.survey_id}/`),
    ).length,
    0,
  );
});

test("1.1 e2e: in-place edit keeps IDs and created_at, and refuses once answered", async () => {
  const bucket = new FakeR2Bucket();
  const env = { ...authEnv, SURVEY_BUCKET: bucket };
  const headers = await adminHeaders();

  const created = await createManual(bucket, headers, "Editable", [
    { type: "text", label: "First", required: true, options: [] },
  ]);

  const editResponse = await worker.fetch(
    request(`/api/admin/questionnaires/${created.survey_id}`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Edited title",
        questions: [
          {
            question_id: "q1",
            type: "text",
            label: "First (edited)",
            required: false,
            options: [],
          },
          { type: "number", label: "Second", required: false, options: [] },
        ],
      }),
    }),
    env,
  );
  assert.equal(editResponse.status, 200);
  const edited = (await editResponse.json()).survey;
  assert.equal(edited.title, "Edited title");
  assert.equal(edited.created_at, created.created_at);

  const storedCsv = bucket.objects.get(
    `v1/surveys/${created.survey_id}/definition.csv`,
  ).value;
  assert.deepEqual(
    parseQuestionnaireCsv(storedCsv).questions.map((question) => question.question_id),
    ["q1", "q2"],
  );

  const submit = await worker.fetch(
    request(`/api/questionnaires/${created.survey_id}/submissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "person@example.com",
        answers: { q1: "Answered", q2: "3" },
      }),
    }),
    env,
  );
  assert.equal(submit.status, 201);

  const refusedEdit = await worker.fetch(
    request(`/api/admin/questionnaires/${created.survey_id}`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Should not save",
        questions: [{ type: "text", label: "No", required: false, options: [] }],
      }),
    }),
    env,
  );
  assert.equal(refusedEdit.status, 409);
  assert.equal(
    (await refusedEdit.json()).code,
    "QUESTIONNAIRE_HAS_SUBMISSIONS",
  );

  const listResponse = await worker.fetch(
    request(`/api/admin/questionnaires/${created.survey_id}/submissions`, {
      headers,
    }),
    env,
  );
  const { submissions } = await listResponse.json();
  const deleteSubmission = await worker.fetch(
    request(
      `/api/admin/questionnaires/${created.survey_id}/submissions/${submissions[0].submission_id}?` +
        new URLSearchParams({ submitted_at: submissions[0].submitted_at }),
      { method: "DELETE", headers },
    ),
    env,
  );
  assert.equal(deleteSubmission.status, 204);

  const deleteSurvey = await worker.fetch(
    request(`/api/admin/questionnaires/${created.survey_id}`, {
      method: "DELETE",
      headers,
    }),
    env,
  );
  assert.equal(deleteSurvey.status, 204);
});
