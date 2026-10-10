import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";
import {
  ADMIN_AUTH,
  createAdminSessionToken,
} from "../src/admin-auth.js";
import { parseQuestionnaireCsv } from "../src/questionnaire-csv.js";

const authEnv = {
  ADMIN_PASSWORD: "synthetic-admin-password",
  SESSION_SECRET: "synthetic-session-secret-with-at-least-thirty-two-bytes",
};

class FakeR2Bucket {
  constructor() {
    this.objects = new Map();
    this.calls = [];
  }

  async head(key) {
    this.calls.push({ method: "head", key });
    return this.objects.has(key) ? { key } : null;
  }

  async get(key) {
    this.calls.push({ method: "get", key });
    const stored = this.objects.get(key);
    if (stored === undefined) {
      return null;
    }
    return {
      async json() {
        return JSON.parse(stored.value);
      },
    };
  }

  async put(key, value, options = {}) {
    this.calls.push({ method: "put", key, value, options });
    if (options.onlyIf?.etagDoesNotMatch === "*" && this.objects.has(key)) {
      return null;
    }
    this.objects.set(key, { value, options });
    return { key };
  }

  async list(options = {}) {
    this.calls.push({ method: "list", options });
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

async function authorizedHeaders() {
  const token = await createAdminSessionToken(authEnv);
  return { Cookie: `${ADMIN_AUTH.cookieName}=${token}` };
}

function manualBody() {
  return {
    title: "Manual survey",
    questions: [
      {
        question_id: "experience",
        type: "single_choice",
        label: "How was your experience?",
        required: true,
        options: ["Great", "Okay", "Poor"],
      },
    ],
  };
}

test("rejects unauthenticated questionnaire access before touching R2", async () => {
  const bucket = new FakeR2Bucket();
  const response = await worker.fetch(
    request("/api/admin/questionnaires"),
    { ...authEnv, SURVEY_BUCKET: bucket },
  );

  assert.equal(response.status, 401);
  assert.equal(bucket.calls.length, 0);
});

test("creates a manual questionnaire as canonical CSV and lists its metadata", async () => {
  const bucket = new FakeR2Bucket();
  const headers = await authorizedHeaders();
  const createResponse = await worker.fetch(
    request("/api/admin/questionnaires", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(manualBody()),
    }),
    { ...authEnv, SURVEY_BUCKET: bucket },
  );

  assert.equal(createResponse.status, 201);
  const { survey } = await createResponse.json();
  assert.equal(survey.title, "Manual survey");
  assert.equal(survey.source_filename, "Manual survey.csv");

  const definitionKey = `v1/surveys/${survey.survey_id}/definition.csv`;
  const storedCsv = bucket.objects.get(definitionKey).value;
  assert.deepEqual(parseQuestionnaireCsv(storedCsv), {
    questions: [
      {
        question_id: "experience",
        type: "single_choice",
        label: "How was your experience?",
        required: true,
        options: ["Great", "Okay", "Poor"],
      },
    ],
  });

  const listResponse = await worker.fetch(
    request("/api/admin/questionnaires", { headers }),
    { ...authEnv, SURVEY_BUCKET: bucket },
  );
  assert.equal(listResponse.status, 200);
  assert.deepEqual(await listResponse.json(), {
    surveys: [survey],
    cursor: null,
  });
});

test("uploads a valid CSV questionnaire", async () => {
  const bucket = new FakeR2Bucket();
  const body = new FormData();
  body.append(
    "file",
    new Blob([
      "question_id,type,label,required,options\nemail,email,Email address,true,",
    ], { type: "text/csv" }),
    "Uploaded survey.csv",
  );
  const response = await worker.fetch(
    request("/api/admin/questionnaires", {
      method: "POST",
      headers: await authorizedHeaders(),
      body,
    }),
    { ...authEnv, SURVEY_BUCKET: bucket },
  );

  assert.equal(response.status, 201);
  const { survey } = await response.json();
  assert.equal(survey.title, "Uploaded survey");
  assert.equal(survey.source_filename, "Uploaded survey.csv");
  assert.equal(
    bucket.calls.filter(({ method }) => method === "put").length,
    2,
  );
});

test("rejects an invalid CSV upload without writing R2 objects", async () => {
  const bucket = new FakeR2Bucket();
  const body = new FormData();
  body.append(
    "file",
    new Blob(["wrong,header\nvalue,value"], { type: "text/csv" }),
    "Invalid survey.csv",
  );
  const response = await worker.fetch(
    request("/api/admin/questionnaires", {
      method: "POST",
      headers: await authorizedHeaders(),
      body,
    }),
    { ...authEnv, SURVEY_BUCKET: bucket },
  );
  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(result.code, "INVALID_HEADER");
  assert.match(result.error, /header/u);
  assert.equal(bucket.calls.filter(({ method }) => method === "put").length, 0);
});

test("returns actionable validation errors without writing R2 objects", async () => {
  const bucket = new FakeR2Bucket();
  const input = manualBody();
  input.questions[0].options = [];
  const response = await worker.fetch(
    request("/api/admin/questionnaires", {
      method: "POST",
      headers: {
        ...(await authorizedHeaders()),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    }),
    { ...authEnv, SURVEY_BUCKET: bucket },
  );
  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(result.code, "INVALID_OPTIONS");
  assert.match(result.error, /options are required/u);
  assert.equal(bucket.calls.filter(({ method }) => method === "put").length, 0);
});

test("rejects invalid uploads and unsupported methods without writes", async () => {
  const bucket = new FakeR2Bucket();
  const headers = await authorizedHeaders();
  const invalidUpload = new FormData();
  invalidUpload.append("unexpected", "value");

  const uploadResponse = await worker.fetch(
    request("/api/admin/questionnaires", {
      method: "POST",
      headers,
      body: invalidUpload,
    }),
    { ...authEnv, SURVEY_BUCKET: bucket },
  );
  assert.equal(uploadResponse.status, 400);
  assert.equal((await uploadResponse.json()).code, "INVALID_UPLOAD");

  const methodResponse = await worker.fetch(
    request("/api/admin/questionnaires", { method: "DELETE", headers }),
    { ...authEnv, SURVEY_BUCKET: bucket },
  );
  assert.equal(methodResponse.status, 405);
  assert.equal(methodResponse.headers.get("Allow"), "GET, POST");
  assert.equal(bucket.calls.filter(({ method }) => method === "put").length, 0);
});
