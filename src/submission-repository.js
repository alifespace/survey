import { submissionKey, submissionListPrefix } from "./object-keys.js";
import { getQuestionnaire } from "./questionnaire-repository.js";

export const SUBMISSION_LIMITS = Object.freeze({
  maxEmailCharacters: 254,
  maxTextAnswerCharacters: 4000,
  maxNumberAnswerCharacters: 100,
});

export const SUBMISSION_LIST_LIMITS = Object.freeze({
  defaultLimit: 50,
  maxLimit: 100,
});

const EMAIL_PATTERN = /^[^\s@\0-\x1F\x7F]+@[^\s@\0-\x1F\x7F]+\.[^\s@\0-\x1F\x7F]+$/u;
const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;

export class SubmissionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SubmissionError";
    this.code = code;
  }
}

export class StoredSubmissionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StoredSubmissionError";
    this.code = code;
  }
}

function characterCount(value) {
  return Array.from(value).length;
}

export function normalizeEmail(value) {
  if (typeof value !== "string") {
    throw new SubmissionError("INVALID_EMAIL", "email must be a string");
  }

  const email = value.trim();
  if (
    characterCount(email) > SUBMISSION_LIMITS.maxEmailCharacters ||
    !EMAIL_PATTERN.test(email)
  ) {
    throw new SubmissionError("INVALID_EMAIL", "email is invalid");
  }
  return email;
}

function emptyAnswer(question) {
  return question.type === "multi_choice" ? [] : "";
}

function requiredError(question) {
  return new SubmissionError(
    "REQUIRED_ANSWER_MISSING",
    `Answer is required: ${question.question_id}`,
  );
}

function validateTextAnswer(question, value) {
  if (typeof value !== "string") {
    throw new SubmissionError(
      "INVALID_ANSWER_TYPE",
      `Answer must be a string: ${question.question_id}`,
    );
  }
  if (value.trim() === "") {
    if (question.required) {
      throw requiredError(question);
    }
    return "";
  }
  if (characterCount(value) > SUBMISSION_LIMITS.maxTextAnswerCharacters) {
    throw new SubmissionError(
      "ANSWER_TOO_LONG",
      `Answer is too long: ${question.question_id}`,
    );
  }
  return value;
}

function validateEmailAnswer(question, value) {
  if (value === "" || value === undefined) {
    if (question.required) {
      throw requiredError(question);
    }
    return "";
  }
  try {
    return normalizeEmail(value);
  } catch {
    throw new SubmissionError(
      "INVALID_EMAIL_ANSWER",
      `Email answer is invalid: ${question.question_id}`,
    );
  }
}

function validateNumberAnswer(question, value) {
  if (value === "" || value === undefined) {
    if (question.required) {
      throw requiredError(question);
    }
    return "";
  }
  if (typeof value !== "string") {
    throw new SubmissionError(
      "INVALID_ANSWER_TYPE",
      `Answer must be a string: ${question.question_id}`,
    );
  }

  const number = value.trim();
  if (
    number.length > SUBMISSION_LIMITS.maxNumberAnswerCharacters ||
    !NUMBER_PATTERN.test(number) ||
    !Number.isFinite(Number(number))
  ) {
    throw new SubmissionError(
      "INVALID_NUMBER_ANSWER",
      `Number answer is invalid: ${question.question_id}`,
    );
  }
  return number;
}

function validateSingleChoiceAnswer(question, value) {
  if (value === "" || value === undefined) {
    if (question.required) {
      throw requiredError(question);
    }
    return "";
  }
  if (typeof value !== "string" || !question.options.includes(value)) {
    throw new SubmissionError(
      "INVALID_CHOICE_ANSWER",
      `Choice answer is invalid: ${question.question_id}`,
    );
  }
  return value;
}

function validateMultiChoiceAnswer(question, value) {
  if (value === undefined) {
    if (question.required) {
      throw requiredError(question);
    }
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new SubmissionError(
      "INVALID_ANSWER_TYPE",
      `Answer must be a string array: ${question.question_id}`,
    );
  }
  if (value.length === 0) {
    if (question.required) {
      throw requiredError(question);
    }
    return [];
  }
  if (
    new Set(value).size !== value.length ||
    value.some((item) => !question.options.includes(item))
  ) {
    throw new SubmissionError(
      "INVALID_CHOICE_ANSWER",
      `Choice answer is invalid: ${question.question_id}`,
    );
  }
  return value;
}

function validateAnswer(question, value) {
  if (value === undefined) {
    if (question.required) {
      throw requiredError(question);
    }
    return emptyAnswer(question);
  }

  if (question.type === "text" || question.type === "textarea") {
    return validateTextAnswer(question, value);
  }
  if (question.type === "email") {
    return validateEmailAnswer(question, value);
  }
  if (question.type === "number") {
    return validateNumberAnswer(question, value);
  }
  if (question.type === "single_choice") {
    return validateSingleChoiceAnswer(question, value);
  }
  if (question.type === "multi_choice") {
    return validateMultiChoiceAnswer(question, value);
  }

  throw new SubmissionError(
    "INVALID_QUESTION_TYPE",
    `Question type is invalid: ${question.question_id}`,
  );
}

export function validateAnswers(questions, input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new SubmissionError("INVALID_ANSWERS", "answers must be an object");
  }

  const questionIds = new Set(questions.map(({ question_id: questionId }) => questionId));
  const unknownQuestionId = Object.keys(input).find((questionId) => !questionIds.has(questionId));
  if (unknownQuestionId !== undefined) {
    throw new SubmissionError(
      "UNKNOWN_QUESTION_ID",
      `Unknown question_id: ${unknownQuestionId}`,
    );
  }

  return Object.fromEntries(
    questions.map((question) => [
      question.question_id,
      validateAnswer(question, input[question.question_id]),
    ]),
  );
}

export async function createSubmission(
  bucket,
  surveyId,
  { email, answers },
  dependencies = {},
) {
  const questionnaire = await getQuestionnaire(bucket, surveyId);
  if (questionnaire === null) {
    throw new SubmissionError("QUESTIONNAIRE_UNAVAILABLE", "Questionnaire is unavailable");
  }

  const normalizedEmail = normalizeEmail(email);
  const normalizedAnswers = validateAnswers(questionnaire.questions, answers);
  const generateId = dependencies.generateId ?? (() => crypto.randomUUID());
  const now = dependencies.now ?? (() => new Date());
  const submissionId = generateId();
  const submittedAt = now().toISOString();
  const key = submissionKey(surveyId, submittedAt, submissionId);

  if (await bucket.head(key) !== null) {
    throw new SubmissionError("SUBMISSION_ALREADY_EXISTS", "Submission already exists");
  }

  const submission = {
    schema_version: 1,
    submission_id: submissionId,
    survey_id: surveyId,
    survey_schema_version: questionnaire.metadata.schema_version,
    email: normalizedEmail,
    submitted_at: submittedAt,
    answers: normalizedAnswers,
  };
  const stored = await bucket.put(key, JSON.stringify(submission), {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
  if (stored === null) {
    throw new SubmissionError("SUBMISSION_ALREADY_EXISTS", "Submission already exists");
  }

  return submission;
}

function validateListOptions(options) {
  const limit = options.limit ?? SUBMISSION_LIST_LIMITS.defaultLimit;
  const cursor = options.cursor;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > SUBMISSION_LIST_LIMITS.maxLimit
  ) {
    throw new StoredSubmissionError(
      "INVALID_LIST_LIMIT",
      `limit must be between 1 and ${SUBMISSION_LIST_LIMITS.maxLimit}`,
    );
  }
  if (cursor !== undefined && (typeof cursor !== "string" || cursor === "")) {
    throw new StoredSubmissionError("INVALID_CURSOR", "cursor must be a non-empty string");
  }
  return { cursor, limit };
}

function sameAnswer(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => value === right[index])
    );
  }
  return left === right;
}

function validateStoredSubmission(value, key, questionnaire) {
  try {
    const expectedFields = [
      "schema_version",
      "submission_id",
      "survey_id",
      "survey_schema_version",
      "email",
      "submitted_at",
      "answers",
    ];
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== expectedFields.length ||
      expectedFields.some((field) => !Object.hasOwn(value, field)) ||
      value.schema_version !== 1 ||
      value.survey_id !== questionnaire.metadata.survey_id ||
      value.survey_schema_version !== questionnaire.metadata.schema_version ||
      normalizeEmail(value.email) !== value.email ||
      submissionKey(value.survey_id, value.submitted_at, value.submission_id) !== key
    ) {
      throw new Error("Invalid submission");
    }

    const normalizedAnswers = validateAnswers(questionnaire.questions, value.answers);
    if (
      Object.keys(value.answers).length !== questionnaire.questions.length ||
      questionnaire.questions.some(
        ({ question_id: questionId }) =>
          !Object.hasOwn(value.answers, questionId) ||
          !sameAnswer(value.answers[questionId], normalizedAnswers[questionId]),
      )
    ) {
      throw new Error("Invalid answers");
    }
  } catch {
    throw new StoredSubmissionError(
      "INVALID_STORED_SUBMISSION",
      `Stored submission is invalid: ${key}`,
    );
  }
  return value;
}

async function readStoredSubmission(bucket, key, questionnaire) {
  const object = await bucket.get(key);
  if (object === null) {
    throw new StoredSubmissionError(
      "MISSING_STORED_SUBMISSION",
      `Stored submission is missing: ${key}`,
    );
  }
  let value;
  try {
    value = await object.json();
  } catch {
    throw new StoredSubmissionError(
      "INVALID_STORED_SUBMISSION",
      `Stored submission is not valid JSON: ${key}`,
    );
  }
  return validateStoredSubmission(value, key, questionnaire);
}

export async function listSubmissions(bucket, questionnaire, options = {}) {
  const { cursor, limit } = validateListOptions(options);
  const listOptions = {
    prefix: submissionListPrefix(questionnaire.metadata.survey_id),
    limit,
  };
  if (cursor !== undefined) {
    listOptions.cursor = cursor;
  }

  const listed = await bucket.list(listOptions);
  const submissions = await Promise.all(
    listed.objects.map(({ key }) => readStoredSubmission(bucket, key, questionnaire)),
  );
  return {
    submissions,
    cursor: listed.truncated ? listed.cursor : null,
  };
}

export async function getSubmission(
  bucket,
  questionnaire,
  submittedAt,
  submissionId,
) {
  const key = submissionKey(
    questionnaire.metadata.survey_id,
    submittedAt,
    submissionId,
  );
  const object = await bucket.get(key);
  if (object === null) {
    return null;
  }
  let value;
  try {
    value = await object.json();
  } catch {
    throw new StoredSubmissionError(
      "INVALID_STORED_SUBMISSION",
      `Stored submission is not valid JSON: ${key}`,
    );
  }
  return validateStoredSubmission(value, key, questionnaire);
}
