import assert from "node:assert/strict";
import test from "node:test";

import {
  createQuestionnaire,
  listQuestionnaires,
  QuestionnaireRepositoryError,
} from "../src/questionnaire-repository.js";

const csv = [
  "question_id,type,label,required,options",
  "name,text,Name,true,",
].join("\n");
const surveyIds = [
  "123e4567-e89b-42d3-a456-426614174000",
  "223e4567-e89b-42d3-a456-426614174000",
  "323e4567-e89b-42d3-a456-426614174000",
];
const createdAt = "2026-10-10T00:00:00.000Z";

class FakeR2Bucket {
  constructor() {
    this.objects = new Map();
    this.calls = [];
  }

  seed(key, value, httpMetadata = {}) {
    this.objects.set(key, { value, httpMetadata });
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
      key,
      async json() {
        return JSON.parse(stored.value);
      },
      async text() {
        return stored.value;
      },
    };
  }

  async put(key, value, options = {}) {
    this.calls.push({ method: "put", key, value, options });
    if (
      options.onlyIf?.etagDoesNotMatch === "*" &&
      this.objects.has(key)
    ) {
      return null;
    }

    this.objects.set(key, {
      value,
      httpMetadata: options.httpMetadata ?? {},
    });
    return { key };
  }

  async list(options = {}) {
    this.calls.push({ method: "list", options });
    const matchingKeys = [...this.objects.keys()]
      .filter((key) => key.startsWith(options.prefix ?? ""))
      .sort();
    const offset = options.cursor === undefined ? 0 : Number(options.cursor);
    const keys = matchingKeys.slice(offset, offset + options.limit);
    const nextOffset = offset + keys.length;
    const truncated = nextOffset < matchingKeys.length;

    return {
      objects: keys.map((key) => ({ key })),
      truncated,
      cursor: truncated ? String(nextOffset) : undefined,
      delimitedPrefixes: [],
    };
  }
}

function dependencies(surveyId = surveyIds[0]) {
  return {
    generateId: () => surveyId,
    now: () => new Date(createdAt),
  };
}

function metadata(surveyId) {
  return {
    schema_version: 1,
    survey_id: surveyId,
    title: `Survey ${surveyId[0]}`,
    source_filename: `Survey ${surveyId[0]}.csv`,
    created_at: createdAt,
    status: "active",
  };
}

function seedQuestionnaire(bucket, surveyId) {
  const value = metadata(surveyId);
  bucket.seed(`v1/surveys/${surveyId}/definition.csv`, csv, {
    contentType: "text/csv; charset=utf-8",
  });
  bucket.seed(
    `v1/surveys/${surveyId}/metadata.json`,
    JSON.stringify(value),
    { contentType: "application/json; charset=utf-8" },
  );
}

test("stores a validated questionnaire definition and metadata", async () => {
  const bucket = new FakeR2Bucket();
  const result = await createQuestionnaire(
    bucket,
    { csv, sourceFilename: "Customer Survey.csv" },
    dependencies(),
  );

  const definitionKey = `v1/surveys/${surveyIds[0]}/definition.csv`;
  const metadataKey = `v1/surveys/${surveyIds[0]}/metadata.json`;
  assert.deepEqual(result, {
    schema_version: 1,
    survey_id: surveyIds[0],
    title: "Customer Survey",
    source_filename: "Customer Survey.csv",
    created_at: createdAt,
    status: "active",
  });
  assert.equal(bucket.objects.get(definitionKey).value, csv);
  assert.deepEqual(
    JSON.parse(bucket.objects.get(metadataKey).value),
    result,
  );

  const putCalls = bucket.calls.filter(({ method }) => method === "put");
  assert.equal(putCalls.length, 2);
  assert.deepEqual(putCalls[0].options, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "text/csv; charset=utf-8" },
  });
  assert.deepEqual(putCalls[1].options, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
});

test("writes nothing when questionnaire CSV validation fails", async () => {
  const bucket = new FakeR2Bucket();

  await assert.rejects(
    createQuestionnaire(
      bucket,
      { csv: "invalid", sourceFilename: "Survey.csv" },
      dependencies(),
    ),
  );
  assert.equal(bucket.objects.size, 0);
  assert.equal(bucket.calls.length, 0);
});

const invalidSourceFilenames = [
  "Survey.txt",
  ".csv",
  "   .csv",
  "../Survey.csv",
  "folder/Survey.csv",
  "folder\\Survey.csv",
  `Survey\0.csv`,
];

for (const sourceFilename of invalidSourceFilenames) {
  test(`writes nothing for an invalid source filename: ${JSON.stringify(sourceFilename)}`, async () => {
    const bucket = new FakeR2Bucket();

    await assert.rejects(
      createQuestionnaire(
        bucket,
        { csv, sourceFilename },
        dependencies(),
      ),
      (error) =>
        error instanceof QuestionnaireRepositoryError &&
        error.code === "INVALID_SOURCE_FILENAME",
    );
    assert.equal(bucket.objects.size, 0);
    assert.equal(bucket.calls.length, 0);
  });
}

test("does not overwrite an existing questionnaire", async () => {
  const bucket = new FakeR2Bucket();
  const definitionKey = `v1/surveys/${surveyIds[0]}/definition.csv`;
  const metadataKey = `v1/surveys/${surveyIds[0]}/metadata.json`;
  bucket.seed(definitionKey, "original definition");
  bucket.seed(metadataKey, "original metadata");

  await assert.rejects(
    createQuestionnaire(
      bucket,
      { csv, sourceFilename: "Survey.csv" },
      dependencies(),
    ),
    (error) =>
      error instanceof QuestionnaireRepositoryError &&
      error.code === "QUESTIONNAIRE_ALREADY_EXISTS",
  );
  assert.equal(bucket.objects.get(definitionKey).value, "original definition");
  assert.equal(bucket.objects.get(metadataKey).value, "original metadata");
  assert.equal(
    bucket.calls.filter(({ method }) => method === "put").length,
    0,
  );
});

test("lists questionnaires with an opaque R2 cursor", async () => {
  const bucket = new FakeR2Bucket();
  for (const surveyId of surveyIds) {
    seedQuestionnaire(bucket, surveyId);
  }

  const firstPage = await listQuestionnaires(bucket, { limit: 2 });
  assert.deepEqual(
    firstPage.surveys.map(({ survey_id: surveyId }) => surveyId),
    surveyIds.slice(0, 2),
  );
  assert.equal(firstPage.cursor, "4");

  const secondPage = await listQuestionnaires(bucket, {
    cursor: firstPage.cursor,
    limit: 2,
  });
  assert.deepEqual(
    secondPage.surveys.map(({ survey_id: surveyId }) => surveyId),
    surveyIds.slice(2),
  );
  assert.equal(secondPage.cursor, null);

  const listCalls = bucket.calls.filter(({ method }) => method === "list");
  assert.deepEqual(listCalls[0].options, {
    prefix: "v1/surveys/",
    limit: 4,
  });
  assert.deepEqual(listCalls[1].options, {
    prefix: "v1/surveys/",
    limit: 4,
    cursor: "4",
  });
});

test("rejects invalid listing options before calling R2", async () => {
  const bucket = new FakeR2Bucket();

  await assert.rejects(listQuestionnaires(bucket, { limit: 0 }), {
    name: "QuestionnaireRepositoryError",
    code: "INVALID_LIST_LIMIT",
  });
  await assert.rejects(listQuestionnaires(bucket, { cursor: "" }), {
    name: "QuestionnaireRepositoryError",
    code: "INVALID_CURSOR",
  });
  assert.equal(bucket.calls.length, 0);
});

test("rejects malformed stored metadata", async () => {
  const bucket = new FakeR2Bucket();
  const key = `v1/surveys/${surveyIds[0]}/metadata.json`;
  bucket.seed(key, '{"schema_version":1}');

  await assert.rejects(listQuestionnaires(bucket), {
    name: "QuestionnaireRepositoryError",
    code: "INVALID_STORED_METADATA",
  });
});
