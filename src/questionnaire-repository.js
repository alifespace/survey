import {
  surveyDefinitionKey,
  surveyListPrefix,
  surveyMetadataKey,
} from "./object-keys.js";
import {
  parseQuestionnaireCsv,
  serializeQuestionnaireCsv,
} from "./questionnaire-csv.js";

export const QUESTIONNAIRE_REPOSITORY_LIMITS = Object.freeze({
  maxSourceFilenameCharacters: 255,
  defaultListLimit: 50,
  maxListLimit: 100,
});

export class QuestionnaireRepositoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "QuestionnaireRepositoryError";
    this.code = code;
  }
}

function characterCount(value) {
  return Array.from(value).length;
}

function questionnaireTitle(sourceFilename) {
  if (
    typeof sourceFilename !== "string" ||
    !sourceFilename.endsWith(".csv") ||
    sourceFilename.length === 4 ||
    sourceFilename.slice(0, -4).trim() === "" ||
    characterCount(sourceFilename) >
      QUESTIONNAIRE_REPOSITORY_LIMITS.maxSourceFilenameCharacters ||
    /[/\\\0-\x1F\x7F]/.test(sourceFilename)
  ) {
    throw new QuestionnaireRepositoryError(
      "INVALID_SOURCE_FILENAME",
      `sourceFilename must be a path-free .csv filename with no more than ${QUESTIONNAIRE_REPOSITORY_LIMITS.maxSourceFilenameCharacters} characters`,
    );
  }

  return sourceFilename.slice(0, -4);
}

function validateBucket(bucket) {
  if (
    bucket === null ||
    typeof bucket !== "object" ||
    typeof bucket.head !== "function" ||
    typeof bucket.get !== "function" ||
    typeof bucket.put !== "function" ||
    typeof bucket.list !== "function"
  ) {
    throw new TypeError("bucket must implement the R2Bucket interface");
  }
}

function validateListOptions(options) {
  const limit =
    options.limit ?? QUESTIONNAIRE_REPOSITORY_LIMITS.defaultListLimit;
  const cursor = options.cursor;

  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > QUESTIONNAIRE_REPOSITORY_LIMITS.maxListLimit
  ) {
    throw new QuestionnaireRepositoryError(
      "INVALID_LIST_LIMIT",
      `limit must be an integer between 1 and ${QUESTIONNAIRE_REPOSITORY_LIMITS.maxListLimit}`,
    );
  }

  if (cursor !== undefined && (typeof cursor !== "string" || cursor === "")) {
    throw new QuestionnaireRepositoryError(
      "INVALID_CURSOR",
      "cursor must be a non-empty string",
    );
  }

  return { cursor, limit };
}

function isCanonicalTimestamp(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function validateStoredMetadata(value, key) {
  try {
    if (
      value === null ||
      typeof value !== "object" ||
      value.schema_version !== 1 ||
      typeof value.title !== "string" ||
      value.title === "" ||
      typeof value.source_filename !== "string" ||
      !isCanonicalTimestamp(value.created_at) ||
      value.status !== "active" ||
      surveyMetadataKey(value.survey_id) !== key
    ) {
      throw new Error("Invalid metadata");
    }
  } catch {
    throw new QuestionnaireRepositoryError(
      "INVALID_STORED_METADATA",
      `Invalid questionnaire metadata at key: ${key}`,
    );
  }

  return value;
}

async function putNewObject(bucket, key, value, httpMetadata) {
  const stored = await bucket.put(key, value, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata,
  });

  if (stored === null) {
    throw new QuestionnaireRepositoryError(
      "QUESTIONNAIRE_ALREADY_EXISTS",
      `Questionnaire object already exists: ${key}`,
    );
  }
}

export async function createQuestionnaire(
  bucket,
  { csv, sourceFilename },
  dependencies = {},
) {
  validateBucket(bucket);
  const parsed = parseQuestionnaireCsv(csv);
  const definitionCsv = parsed.questionIdsGenerated
    ? serializeQuestionnaireCsv(parsed.questions)
    : csv;
  const title = questionnaireTitle(sourceFilename);

  const generateId = dependencies.generateId ?? (() => crypto.randomUUID());
  const now = dependencies.now ?? (() => new Date());
  const surveyId = generateId();
  const createdAt = now().toISOString();
  const definitionKey = surveyDefinitionKey(surveyId);
  const metadataKey = surveyMetadataKey(surveyId);

  const [existingDefinition, existingMetadata] = await Promise.all([
    bucket.head(definitionKey),
    bucket.head(metadataKey),
  ]);

  if (existingDefinition !== null || existingMetadata !== null) {
    throw new QuestionnaireRepositoryError(
      "QUESTIONNAIRE_ALREADY_EXISTS",
      `Questionnaire already exists: ${surveyId}`,
    );
  }

  const metadata = {
    schema_version: 1,
    survey_id: surveyId,
    title,
    source_filename: sourceFilename,
    created_at: createdAt,
    status: "active",
  };

  await putNewObject(bucket, definitionKey, definitionCsv, {
    contentType: "text/csv; charset=utf-8",
  });
  await putNewObject(bucket, metadataKey, JSON.stringify(metadata), {
    contentType: "application/json; charset=utf-8",
  });

  return metadata;
}

export async function getQuestionnaire(bucket, surveyId) {
  validateBucket(bucket);
  const metadataKey = surveyMetadataKey(surveyId);
  const definitionKey = surveyDefinitionKey(surveyId);
  const [metadataObject, definitionObject] = await Promise.all([
    bucket.get(metadataKey),
    bucket.get(definitionKey),
  ]);

  if (metadataObject === null && definitionObject === null) {
    return null;
  }
  if (metadataObject === null || definitionObject === null) {
    throw new QuestionnaireRepositoryError(
      "INCOMPLETE_STORED_QUESTIONNAIRE",
      `Questionnaire objects are incomplete: ${surveyId}`,
    );
  }

  let metadata;
  let csv;
  try {
    [metadata, csv] = await Promise.all([
      metadataObject.json(),
      definitionObject.text(),
    ]);
  } catch {
    throw new QuestionnaireRepositoryError(
      "INVALID_STORED_QUESTIONNAIRE",
      `Questionnaire objects could not be read: ${surveyId}`,
    );
  }

  const validatedMetadata = validateStoredMetadata(metadata, metadataKey);
  try {
    return {
      metadata: validatedMetadata,
      csv,
      questions: parseQuestionnaireCsv(csv).questions,
    };
  } catch {
    throw new QuestionnaireRepositoryError(
      "INVALID_STORED_DEFINITION",
      `Questionnaire definition is invalid: ${surveyId}`,
    );
  }
}

export async function listQuestionnaires(bucket, options = {}) {
  validateBucket(bucket);
  const { cursor, limit } = validateListOptions(options);
  const listOptions = {
    prefix: surveyListPrefix(),
    limit: limit * 2,
  };

  if (cursor !== undefined) {
    listOptions.cursor = cursor;
  }

  const listed = await bucket.list(listOptions);
  const metadataObjects = listed.objects.filter((object) =>
    object.key.endsWith("/metadata.json"),
  );

  const surveys = await Promise.all(
    metadataObjects.map(async ({ key }) => {
      const object = await bucket.get(key);
      if (object === null) {
        throw new QuestionnaireRepositoryError(
          "MISSING_STORED_METADATA",
          `Questionnaire metadata is missing: ${key}`,
        );
      }

      let metadata;
      try {
        metadata = await object.json();
      } catch {
        throw new QuestionnaireRepositoryError(
          "INVALID_STORED_METADATA",
          `Questionnaire metadata is not valid JSON: ${key}`,
        );
      }

      return validateStoredMetadata(metadata, key);
    }),
  );

  return {
    surveys,
    cursor: listed.truncated ? listed.cursor : null,
  };
}
