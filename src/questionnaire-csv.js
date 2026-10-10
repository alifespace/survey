export const QUESTIONNAIRE_LIMITS = Object.freeze({
  maxCsvBytes: 256 * 1024,
  maxQuestions: 200,
  maxQuestionIdCharacters: 64,
  maxLabelCharacters: 1000,
  maxOptionsCharacters: 4000,
  maxOptions: 50,
  maxOptionCharacters: 200,
});

const HEADERS = ["question_id", "type", "label", "required", "options"];
const QUESTION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const QUESTION_TYPES = new Set([
  "text",
  "textarea",
  "email",
  "number",
  "single_choice",
  "multi_choice",
]);
const CHOICE_TYPES = new Set(["single_choice", "multi_choice"]);

export class QuestionnaireCsvError extends Error {
  constructor(code, message, row) {
    super(row === undefined ? message : `Row ${row}: ${message}`);
    this.name = "QuestionnaireCsvError";
    this.code = code;

    if (row !== undefined) {
      this.row = row;
    }
  }
}

function characterCount(value) {
  return Array.from(value).length;
}

function isLineBreak(character) {
  return character === "\n" || character === "\r";
}

function parseRows(source) {
  const rows = [];
  let cells = [];
  let field = "";
  let inQuotedField = false;
  let quotedFieldClosed = false;
  let line = 1;
  let rowStartLine = 1;

  const finishRow = () => {
    cells.push(field);
    rows.push({ cells, line: rowStartLine });
    cells = [];
    field = "";
    quotedFieldClosed = false;
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (inQuotedField) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotedField = false;
          quotedFieldClosed = true;
        }
      } else if (isLineBreak(character)) {
        if (character === "\r" && source[index + 1] === "\n") {
          index += 1;
        }
        field += "\n";
        line += 1;
      } else {
        field += character;
      }

      continue;
    }

    if (quotedFieldClosed) {
      if (character === ",") {
        cells.push(field);
        field = "";
        quotedFieldClosed = false;
      } else if (isLineBreak(character)) {
        if (character === "\r" && source[index + 1] === "\n") {
          index += 1;
        }
        finishRow();
        line += 1;
        rowStartLine = line;
      } else {
        throw new QuestionnaireCsvError(
          "CSV_SYNTAX_ERROR",
          "Unexpected character after a closing quote",
          line,
        );
      }

      continue;
    }

    if (character === '"') {
      if (field.length !== 0) {
        throw new QuestionnaireCsvError(
          "CSV_SYNTAX_ERROR",
          "Unexpected quote in an unquoted field",
          line,
        );
      }
      inQuotedField = true;
    } else if (character === ",") {
      cells.push(field);
      field = "";
    } else if (isLineBreak(character)) {
      if (character === "\r" && source[index + 1] === "\n") {
        index += 1;
      }
      finishRow();
      line += 1;
      rowStartLine = line;
    } else {
      field += character;
    }
  }

  if (inQuotedField) {
    throw new QuestionnaireCsvError(
      "CSV_SYNTAX_ERROR",
      "Unterminated quoted field",
      rowStartLine,
    );
  }

  if (quotedFieldClosed || cells.length > 0 || field.length > 0) {
    finishRow();
  }

  return rows;
}

function isBlankRow(row) {
  return row.cells.length === 1 && row.cells[0].trim() === "";
}

function validateHeader(header) {
  if (header === undefined) {
    throw new QuestionnaireCsvError(
      "INVALID_HEADER",
      `Expected header: ${HEADERS.join(",")}`,
    );
  }

  const duplicate = header.cells.find(
    (value, index) => header.cells.indexOf(value) !== index,
  );
  if (duplicate !== undefined) {
    throw new QuestionnaireCsvError(
      "INVALID_HEADER",
      `Duplicate header: ${duplicate}`,
      header.line,
    );
  }

  const unknown = header.cells.find((value) => !HEADERS.includes(value));
  if (unknown !== undefined) {
    throw new QuestionnaireCsvError(
      "INVALID_HEADER",
      `Unknown header: ${unknown}`,
      header.line,
    );
  }

  const missing = HEADERS.find((value) => !header.cells.includes(value));
  if (missing !== undefined) {
    throw new QuestionnaireCsvError(
      "INVALID_HEADER",
      `Missing header: ${missing}`,
      header.line,
    );
  }

  if (
    header.cells.length !== HEADERS.length ||
    header.cells.some((value, index) => value !== HEADERS[index])
  ) {
    throw new QuestionnaireCsvError(
      "INVALID_HEADER",
      `Header order must be: ${HEADERS.join(",")}`,
      header.line,
    );
  }
}

function validateQuestion(row, seenQuestionIds) {
  if (row.cells.length !== HEADERS.length) {
    throw new QuestionnaireCsvError(
      "INVALID_COLUMN_COUNT",
      `Expected ${HEADERS.length} columns but received ${row.cells.length}`,
      row.line,
    );
  }

  const [questionId, type, label, required, optionsValue] = row.cells;

  if (
    !QUESTION_ID_PATTERN.test(questionId) ||
    characterCount(questionId) > QUESTIONNAIRE_LIMITS.maxQuestionIdCharacters
  ) {
    throw new QuestionnaireCsvError(
      "INVALID_QUESTION_ID",
      `question_id must contain 1-${QUESTIONNAIRE_LIMITS.maxQuestionIdCharacters} ASCII letters, numbers, underscores, or hyphens`,
      row.line,
    );
  }

  if (seenQuestionIds.has(questionId)) {
    throw new QuestionnaireCsvError(
      "DUPLICATE_QUESTION_ID",
      `Duplicate question_id: ${questionId}`,
      row.line,
    );
  }
  seenQuestionIds.add(questionId);

  if (!QUESTION_TYPES.has(type)) {
    throw new QuestionnaireCsvError(
      "INVALID_TYPE",
      `Unsupported type: ${type || "(empty)"}`,
      row.line,
    );
  }

  if (
    label.trim() === "" ||
    characterCount(label) > QUESTIONNAIRE_LIMITS.maxLabelCharacters
  ) {
    throw new QuestionnaireCsvError(
      "INVALID_LABEL",
      `label must contain 1-${QUESTIONNAIRE_LIMITS.maxLabelCharacters} characters`,
      row.line,
    );
  }

  if (required !== "true" && required !== "false") {
    throw new QuestionnaireCsvError(
      "INVALID_REQUIRED",
      "required must be exactly true or false",
      row.line,
    );
  }

  if (
    characterCount(optionsValue) > QUESTIONNAIRE_LIMITS.maxOptionsCharacters
  ) {
    throw new QuestionnaireCsvError(
      "INVALID_OPTIONS",
      `options must not exceed ${QUESTIONNAIRE_LIMITS.maxOptionsCharacters} characters`,
      row.line,
    );
  }

  let options = [];
  if (CHOICE_TYPES.has(type)) {
    if (optionsValue === "") {
      throw new QuestionnaireCsvError(
        "INVALID_OPTIONS",
        `options are required for ${type}`,
        row.line,
      );
    }

    options = optionsValue.split("|").map((option) => option.trim());
    if (options.some((option) => option === "")) {
      throw new QuestionnaireCsvError(
        "INVALID_OPTIONS",
        "options must not contain empty values",
        row.line,
      );
    }
    if (options.length > QUESTIONNAIRE_LIMITS.maxOptions) {
      throw new QuestionnaireCsvError(
        "INVALID_OPTIONS",
        `options must not contain more than ${QUESTIONNAIRE_LIMITS.maxOptions} values`,
        row.line,
      );
    }
    if (
      options.some(
        (option) =>
          characterCount(option) > QUESTIONNAIRE_LIMITS.maxOptionCharacters,
      )
    ) {
      throw new QuestionnaireCsvError(
        "INVALID_OPTIONS",
        `each option must not exceed ${QUESTIONNAIRE_LIMITS.maxOptionCharacters} characters`,
        row.line,
      );
    }
  } else if (optionsValue !== "") {
    throw new QuestionnaireCsvError(
      "INVALID_OPTIONS",
      `options must be empty for ${type}`,
      row.line,
    );
  }

  return {
    question_id: questionId,
    type,
    label,
    required: required === "true",
    options,
  };
}

export function parseQuestionnaireCsv(input) {
  if (typeof input !== "string") {
    throw new QuestionnaireCsvError(
      "INVALID_INPUT",
      "Questionnaire CSV must be a string",
    );
  }

  if (new TextEncoder().encode(input).byteLength > QUESTIONNAIRE_LIMITS.maxCsvBytes) {
    throw new QuestionnaireCsvError(
      "CSV_TOO_LARGE",
      `Questionnaire CSV must not exceed ${QUESTIONNAIRE_LIMITS.maxCsvBytes} bytes`,
    );
  }

  const source = input.startsWith("\uFEFF") ? input.slice(1) : input;
  const rows = parseRows(source).filter((row) => !isBlankRow(row));
  const [header, ...questionRows] = rows;

  validateHeader(header);

  if (questionRows.length === 0) {
    throw new QuestionnaireCsvError(
      "NO_QUESTIONS",
      "Questionnaire must contain at least one question",
    );
  }

  if (questionRows.length > QUESTIONNAIRE_LIMITS.maxQuestions) {
    throw new QuestionnaireCsvError(
      "TOO_MANY_QUESTIONS",
      `Questionnaire must not contain more than ${QUESTIONNAIRE_LIMITS.maxQuestions} questions`,
    );
  }

  const seenQuestionIds = new Set();
  return {
    questions: questionRows.map((row) =>
      validateQuestion(row, seenQuestionIds),
    ),
  };
}
