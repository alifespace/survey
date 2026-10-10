const OBJECT_KEY_PREFIX = "v1";
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function validateIdentifier(value, name) {
  if (typeof value !== "string" || !UUID_V4_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a lowercase UUID v4`);
  }

  return value;
}

function validateSubmittedAt(value) {
  if (
    typeof value !== "string" ||
    !UTC_TIMESTAMP_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new TypeError(
      "submittedAt must be a canonical UTC ISO-8601 timestamp",
    );
  }

  return value;
}

export function surveyDefinitionKey(surveyId) {
  const validSurveyId = validateIdentifier(surveyId, "surveyId");
  return `${surveyListPrefix()}${validSurveyId}/definition.csv`;
}

export function surveyMetadataKey(surveyId) {
  const validSurveyId = validateIdentifier(surveyId, "surveyId");
  return `${surveyListPrefix()}${validSurveyId}/metadata.json`;
}

export function surveyListPrefix() {
  return `${OBJECT_KEY_PREFIX}/surveys/`;
}

export function submissionKey(surveyId, submittedAt, submissionId) {
  const validSurveyId = validateIdentifier(surveyId, "surveyId");
  const validSubmittedAt = validateSubmittedAt(submittedAt);
  const validSubmissionId = validateIdentifier(submissionId, "submissionId");

  return `${OBJECT_KEY_PREFIX}/submissions/${validSurveyId}/${validSubmittedAt}_${validSubmissionId}.json`;
}

export function submissionListPrefix(surveyId) {
  const validSurveyId = validateIdentifier(surveyId, "surveyId");
  return `${OBJECT_KEY_PREFIX}/submissions/${validSurveyId}/`;
}
