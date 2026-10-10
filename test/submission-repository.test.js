import assert from "node:assert/strict";
import test from "node:test";

import {
  createSubmission,
  SubmissionError,
} from "../src/submission-repository.js";

const surveyId = "123e4567-e89b-42d3-a456-426614174000";
const submissionId = "987e6543-e21b-42d3-b456-426614174999";
const submittedAt = "2026-10-10T01:02:03.004Z";
const definition = [
  "question_id,type,label,required,options",
  "name,text,Name,true,",
  "notes,textarea,Notes,false,",
  "contact,email,Contact email,false,",
  "score,number,Score,true,",
  "rating,single_choice,Rating,true,Good|Average|Poor",
  "features,multi_choice,Features,false,Fast|Simple|Clear",
].join("\n");

class FakeR2Bucket {
  constructor({ includeQuestionnaire = true } = {}) {
    this.objects = new Map();
    this.calls = [];
    if (includeQuestionnaire) {
      this.seedQuestionnaire();
    }
  }

  seedQuestionnaire() {
    this.objects.set(`v1/surveys/${surveyId}/definition.csv`, definition);
    this.objects.set(`v1/surveys/${surveyId}/metadata.json`, JSON.stringify({
      schema_version: 1,
      survey_id: surveyId,
      title: "Feedback",
      source_filename: "Feedback.csv",
      created_at: "2026-10-10T00:00:00.000Z",
      status: "active",
    }));
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

  async put(key, value, options = {}) {
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

function validInput() {
  return {
    email: " respondent@example.com ",
    answers: {
      name: "Ada",
      notes: "",
      contact: "ada@example.com",
      score: " 9.5 ",
      rating: "Good",
      features: ["Fast", "Clear"],
    },
  };
}

const dependencies = {
  generateId: () => submissionId,
  now: () => new Date(submittedAt),
};

test("stores a validated immutable submission with normalized answers", async () => {
  const bucket = new FakeR2Bucket();
  const submission = await createSubmission(
    bucket,
    surveyId,
    validInput(),
    dependencies,
  );
  const key = `v1/submissions/${surveyId}/${submittedAt}_${submissionId}.json`;

  assert.deepEqual(submission, {
    schema_version: 1,
    submission_id: submissionId,
    survey_id: surveyId,
    survey_schema_version: 1,
    email: "respondent@example.com",
    submitted_at: submittedAt,
    answers: {
      name: "Ada",
      notes: "",
      contact: "ada@example.com",
      score: "9.5",
      rating: "Good",
      features: ["Fast", "Clear"],
    },
  });
  assert.deepEqual(JSON.parse(bucket.objects.get(key)), submission);
  const putCall = bucket.calls.find(({ method }) => method === "put");
  assert.deepEqual(putCall.options, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
});

test("normalizes missing optional answers", async () => {
  const bucket = new FakeR2Bucket();
  const input = validInput();
  delete input.answers.notes;
  delete input.answers.contact;
  delete input.answers.features;
  const submission = await createSubmission(bucket, surveyId, input, dependencies);

  assert.equal(submission.answers.notes, "");
  assert.equal(submission.answers.contact, "");
  assert.deepEqual(submission.answers.features, []);
});

const invalidCases = [
  {
    description: "invalid respondent email",
    code: "INVALID_EMAIL",
    change(input) {
      input.email = "not-an-email";
    },
  },
  {
    description: "unknown question ID",
    code: "UNKNOWN_QUESTION_ID",
    change(input) {
      input.answers.unknown = "value";
    },
  },
  {
    description: "missing required answer",
    code: "REQUIRED_ANSWER_MISSING",
    change(input) {
      delete input.answers.name;
    },
  },
  {
    description: "wrong multi-choice type",
    code: "INVALID_ANSWER_TYPE",
    change(input) {
      input.answers.features = "Fast";
    },
  },
  {
    description: "unknown single-choice option",
    code: "INVALID_CHOICE_ANSWER",
    change(input) {
      input.answers.rating = "Excellent";
    },
  },
  {
    description: "duplicate multi-choice option",
    code: "INVALID_CHOICE_ANSWER",
    change(input) {
      input.answers.features = ["Fast", "Fast"];
    },
  },
  {
    description: "invalid number",
    code: "INVALID_NUMBER_ANSWER",
    change(input) {
      input.answers.score = "Infinity";
    },
  },
  {
    description: "invalid email answer",
    code: "INVALID_EMAIL_ANSWER",
    change(input) {
      input.answers.contact = "invalid";
    },
  },
  {
    description: "text answer over the limit",
    code: "ANSWER_TOO_LONG",
    change(input) {
      input.answers.notes = "x".repeat(4001);
    },
  },
];

for (const { description, code, change } of invalidCases) {
  test(`rejects ${description} without writing an object`, async () => {
    const bucket = new FakeR2Bucket();
    const input = validInput();
    change(input);

    await assert.rejects(
      createSubmission(bucket, surveyId, input, dependencies),
      (error) => error instanceof SubmissionError && error.code === code,
    );
    assert.equal(bucket.calls.some(({ method }) => method === "put"), false);
  });
}

test("rejects an unavailable questionnaire without writing", async () => {
  const bucket = new FakeR2Bucket({ includeQuestionnaire: false });
  await assert.rejects(
    createSubmission(bucket, surveyId, validInput(), dependencies),
    (error) =>
      error instanceof SubmissionError &&
      error.code === "QUESTIONNAIRE_UNAVAILABLE",
  );
  assert.equal(bucket.calls.some(({ method }) => method === "put"), false);
});

test("does not overwrite an existing submission", async () => {
  const bucket = new FakeR2Bucket();
  const key = `v1/submissions/${surveyId}/${submittedAt}_${submissionId}.json`;
  bucket.objects.set(key, "original");

  await assert.rejects(
    createSubmission(bucket, surveyId, validInput(), dependencies),
    (error) =>
      error instanceof SubmissionError &&
      error.code === "SUBMISSION_ALREADY_EXISTS",
  );
  assert.equal(bucket.objects.get(key), "original");
  assert.equal(bucket.calls.some(({ method }) => method === "put"), false);
});
