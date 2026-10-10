const EMAIL_PATTERN = /^[^\s@\0-\x1F\x7F]+@[^\s@\0-\x1F\x7F]+\.[^\s@\0-\x1F\x7F]+$/u;
const QUESTION_TYPES = new Set([
  "text",
  "textarea",
  "email",
  "number",
  "single_choice",
  "multi_choice",
]);

export function isValidEmail(value) {
  if (typeof value !== "string") {
    return false;
  }
  const email = value.trim();
  return Array.from(email).length <= 254 && EMAIL_PATTERN.test(email);
}

export async function loadAvailableQuestionnaires(fetchFunction = fetch) {
  const surveys = [];
  const seenCursors = new Set();
  let cursor = null;

  do {
    const query = cursor === null
      ? ""
      : `?${new URLSearchParams({ cursor })}`;
    const response = await fetchFunction(`/api/questionnaires${query}`);
    if (!response.ok) {
      throw new Error("QUESTIONNAIRE_LIST_UNAVAILABLE");
    }

    const result = await response.json();
    if (
      result === null ||
      typeof result !== "object" ||
      !Array.isArray(result.surveys) ||
      (result.cursor !== null && typeof result.cursor !== "string")
    ) {
      throw new Error("INVALID_QUESTIONNAIRE_LIST");
    }

    for (const survey of result.surveys) {
      if (
        survey === null ||
        typeof survey !== "object" ||
        typeof survey.survey_id !== "string" ||
        typeof survey.title !== "string"
      ) {
        throw new Error("INVALID_QUESTIONNAIRE_LIST");
      }
      surveys.push(survey);
    }

    cursor = result.cursor;
    if (cursor !== null) {
      if (seenCursors.has(cursor)) {
        throw new Error("INVALID_QUESTIONNAIRE_CURSOR");
      }
      seenCursors.add(cursor);
    }
  } while (cursor !== null);

  return surveys;
}

function isValidQuestion(question) {
  return (
    question !== null &&
    typeof question === "object" &&
    typeof question.question_id === "string" &&
    typeof question.type === "string" &&
    QUESTION_TYPES.has(question.type) &&
    typeof question.label === "string" &&
    typeof question.required === "boolean" &&
    Array.isArray(question.options) &&
    question.options.every((option) => typeof option === "string")
  );
}

export async function loadQuestionnaire(surveyId, fetchFunction = fetch) {
  const response = await fetchFunction(
    `/api/questionnaires/${encodeURIComponent(surveyId)}`,
  );
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "QUESTIONNAIRE_UNAVAILABLE"
        : "QUESTIONNAIRE_LOAD_FAILED",
    );
  }

  const result = await response.json();
  const survey = result?.survey;
  if (
    survey === null ||
    typeof survey !== "object" ||
    survey.survey_id !== surveyId ||
    typeof survey.title !== "string" ||
    !Array.isArray(survey.questions) ||
    !survey.questions.every(isValidQuestion)
  ) {
    throw new Error("INVALID_QUESTIONNAIRE");
  }
  return survey;
}

export async function submitQuestionnaire(
  surveyId,
  submission,
  fetchFunction = fetch,
) {
  const response = await fetchFunction(
    `/api/questionnaires/${encodeURIComponent(surveyId)}/submissions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submission),
    },
  );
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(
      response.status === 404
        ? "QUESTIONNAIRE_UNAVAILABLE"
        : "SUBMISSION_FAILED",
    );
    error.code = result?.code;
    throw error;
  }
  if (
    result?.submission === null ||
    typeof result?.submission !== "object" ||
    typeof result.submission.submission_id !== "string" ||
    typeof result.submission.submitted_at !== "string"
  ) {
    throw new Error("INVALID_SUBMISSION_RESPONSE");
  }
  return result.submission;
}
