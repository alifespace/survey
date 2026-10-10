import { parseQuestionnaireCsv } from "./questionnaire-csv.js";

export const MANUAL_QUESTIONNAIRE_LIMITS = Object.freeze({
  maxTitleCharacters: 251,
});

export class ManualQuestionnaireError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ManualQuestionnaireError";
    this.code = code;
  }
}

function characterCount(value) {
  return Array.from(value).length;
}

function validateTitle(title) {
  if (
    typeof title !== "string" ||
    title.trim() === "" ||
    characterCount(title) > MANUAL_QUESTIONNAIRE_LIMITS.maxTitleCharacters ||
    /[/\\\0-\x1F\x7F]/u.test(title)
  ) {
    throw new ManualQuestionnaireError(
      "INVALID_TITLE",
      `title must contain 1-${MANUAL_QUESTIONNAIRE_LIMITS.maxTitleCharacters} characters and must not contain path separators or control characters`,
    );
  }

  return title;
}

function csvCell(value) {
  if (/[",\r\n]/u.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function questionRow(question, index) {
  if (question === null || typeof question !== "object" || Array.isArray(question)) {
    throw new ManualQuestionnaireError(
      "INVALID_QUESTION",
      `Question ${index + 1} must be an object`,
    );
  }

  const { question_id: questionId, type, label, required, options } = question;
  if (
    typeof questionId !== "string" ||
    typeof type !== "string" ||
    typeof label !== "string" ||
    typeof required !== "boolean" ||
    !Array.isArray(options) ||
    options.some((option) => typeof option !== "string")
  ) {
    throw new ManualQuestionnaireError(
      "INVALID_QUESTION",
      `Question ${index + 1} has an invalid field type`,
    );
  }

  if (options.some((option) => option.includes("|"))) {
    throw new ManualQuestionnaireError(
      "INVALID_QUESTION",
      `Question ${index + 1} options must not contain the | separator`,
    );
  }

  return [
    questionId,
    type,
    label,
    required ? "true" : "false",
    options.join("|"),
  ]
    .map(csvCell)
    .join(",");
}

export function serializeManualQuestionnaire(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ManualQuestionnaireError(
      "INVALID_INPUT",
      "Questionnaire must be an object",
    );
  }

  const title = validateTitle(input.title);
  if (!Array.isArray(input.questions)) {
    throw new ManualQuestionnaireError(
      "INVALID_QUESTIONS",
      "questions must be an array",
    );
  }

  const csv = [
    "question_id,type,label,required,options",
    ...input.questions.map(questionRow),
  ].join("\n");

  parseQuestionnaireCsv(csv);

  return {
    csv,
    sourceFilename: `${title}.csv`,
  };
}
