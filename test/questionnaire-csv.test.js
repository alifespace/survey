import assert from "node:assert/strict";
import test from "node:test";

import {
  parseQuestionnaireCsv,
  QUESTIONNAIRE_LIMITS,
  QuestionnaireCsvError,
} from "../src/questionnaire-csv.js";

const header = "question_id,type,label,required,options";

function expectCsvError(csv, code, messagePattern) {
  assert.throws(
    () => parseQuestionnaireCsv(csv),
    (error) =>
      error instanceof QuestionnaireCsvError &&
      error.code === code &&
      messagePattern.test(error.message),
  );
}

test("parses every supported question type in row order", () => {
  const csv = [
    header,
    "name,text,Name,true,",
    "bio,textarea,Biography,false,",
    "contact,email,Email,true,",
    "age,number,Age,false,",
    "rating,single_choice,Rating,true,Good|Neutral|Bad",
    "topics,multi_choice,Topics,false,Cloudflare|R2|Workers",
  ].join("\n");

  assert.deepEqual(parseQuestionnaireCsv(csv), {
    questions: [
      {
        question_id: "name",
        type: "text",
        label: "Name",
        required: true,
        options: [],
      },
      {
        question_id: "bio",
        type: "textarea",
        label: "Biography",
        required: false,
        options: [],
      },
      {
        question_id: "contact",
        type: "email",
        label: "Email",
        required: true,
        options: [],
      },
      {
        question_id: "age",
        type: "number",
        label: "Age",
        required: false,
        options: [],
      },
      {
        question_id: "rating",
        type: "single_choice",
        label: "Rating",
        required: true,
        options: ["Good", "Neutral", "Bad"],
      },
      {
        question_id: "topics",
        type: "multi_choice",
        label: "Topics",
        required: false,
        options: ["Cloudflare", "R2", "Workers"],
      },
    ],
  });
});

test("parses quoted commas, escaped quotes, and line breaks", () => {
  const csv = `${header}\nnotes,textarea,"Line one, ""quoted""\nLine two",false,`;
  const result = parseQuestionnaireCsv(csv);

  assert.equal(result.questions[0].label, 'Line one, "quoted"\nLine two');
});

test("accepts a UTF-8 BOM, CRLF line endings, and blank lines", () => {
  const csv = `\uFEFF${header}\r\n\r\nname,text,Name,true,\r\n`;
  assert.equal(parseQuestionnaireCsv(csv).questions.length, 1);
});

const invalidHeaders = [
  ["unknown", "question_id,type,label,required,unknown", /Unknown header/],
  [
    "duplicate",
    "question_id,type,label,required,required",
    /Duplicate header/,
  ],
  ["missing", "question_id,type,label,required", /Missing header/],
  ["wrong order", "type,question_id,label,required,options", /Header order/],
];

for (const [description, invalidHeader, messagePattern] of invalidHeaders) {
  test(`rejects an invalid header: ${description}`, () => {
    expectCsvError(
      `${invalidHeader}\nname,text,Name,true,`,
      "INVALID_HEADER",
      messagePattern,
    );
  });
}

test("rejects a questionnaire without questions", () => {
  expectCsvError(header, "NO_QUESTIONS", /at least one question/);
});

test("rejects an invalid column count", () => {
  expectCsvError(
    `${header}\nname,text,Name,true`,
    "INVALID_COLUMN_COUNT",
    /Expected 5 columns/,
  );
});

const invalidQuestionIds = [
  ["empty", ""],
  ["space", "question id"],
  ["slash", "question/id"],
  ["too long", "a".repeat(QUESTIONNAIRE_LIMITS.maxQuestionIdCharacters + 1)],
];

for (const [description, questionId] of invalidQuestionIds) {
  test(`rejects an invalid question_id: ${description}`, () => {
    expectCsvError(
      `${header}\n${questionId},text,Name,true,`,
      "INVALID_QUESTION_ID",
      /question_id/,
    );
  });
}

test("rejects a duplicate question_id", () => {
  expectCsvError(
    `${header}\nname,text,Name,true,\nname,text,Other,false,`,
    "DUPLICATE_QUESTION_ID",
    /Duplicate question_id: name/,
  );
});

test("rejects an unsupported type", () => {
  expectCsvError(
    `${header}\nname,select,Name,true,`,
    "INVALID_TYPE",
    /Unsupported type: select/,
  );
});

const invalidRequiredValues = ["TRUE", "yes", "1", ""];

for (const value of invalidRequiredValues) {
  test(`rejects an invalid required value: ${value || "empty"}`, () => {
    expectCsvError(
      `${header}\nname,text,Name,${value},`,
      "INVALID_REQUIRED",
      /exactly true or false/,
    );
  });
}

test("rejects an empty label", () => {
  expectCsvError(
    `${header}\nname,text,   ,true,`,
    "INVALID_LABEL",
    /label must contain/,
  );
});

test("rejects a label over the character limit", () => {
  const label = "a".repeat(QUESTIONNAIRE_LIMITS.maxLabelCharacters + 1);
  expectCsvError(
    `${header}\nname,text,${label},true,`,
    "INVALID_LABEL",
    /label must contain/,
  );
});

const invalidOptionsRows = [
  ["missing choice options", "rating,single_choice,Rating,true,"],
  ["empty choice option", "rating,single_choice,Rating,true,Good||Bad"],
  ["options on text", "name,text,Name,true,Unexpected"],
  [
    "too many options",
    `rating,single_choice,Rating,true,${Array.from(
      { length: QUESTIONNAIRE_LIMITS.maxOptions + 1 },
      (_, index) => `Option ${index}`,
    ).join("|")}`,
  ],
  [
    "option too long",
    `rating,single_choice,Rating,true,${"a".repeat(
      QUESTIONNAIRE_LIMITS.maxOptionCharacters + 1,
    )}`,
  ],
  [
    "options field too long",
    `rating,single_choice,Rating,true,${"a".repeat(
      QUESTIONNAIRE_LIMITS.maxOptionsCharacters + 1,
    )}`,
  ],
];

for (const [description, row] of invalidOptionsRows) {
  test(`rejects invalid options: ${description}`, () => {
    expectCsvError(`${header}\n${row}`, "INVALID_OPTIONS", /options|option/);
  });
}

test("trims leading and trailing whitespace from choice options", () => {
  const result = parseQuestionnaireCsv(
    `${header}\nrating,single_choice,Rating,true, Good | Neutral | Bad `,
  );
  assert.deepEqual(result.questions[0].options, ["Good", "Neutral", "Bad"]);
});

test("rejects more than the maximum number of questions", () => {
  const rows = Array.from(
    { length: QUESTIONNAIRE_LIMITS.maxQuestions + 1 },
    (_, index) => `question_${index},text,Question ${index},false,`,
  );
  expectCsvError(
    [header, ...rows].join("\n"),
    "TOO_MANY_QUESTIONS",
    /must not contain more than/,
  );
});

test("rejects a CSV over the byte limit", () => {
  const oversized = "a".repeat(QUESTIONNAIRE_LIMITS.maxCsvBytes + 1);
  expectCsvError(oversized, "CSV_TOO_LARGE", /must not exceed/);
});

const malformedCsvInputs = [
  ["unterminated quoted field", `${header}\nname,text,"Name,true,`],
  ["quote in unquoted field", `${header}\nname,text,Na"me,true,`],
  ["character after closing quote", `${header}\nname,text,"Name"x,true,`],
];

for (const [description, csv] of malformedCsvInputs) {
  test(`rejects malformed CSV: ${description}`, () => {
    expectCsvError(csv, "CSV_SYNTAX_ERROR", /quote|closing quote/i);
  });
}

test("rejects a non-string input", () => {
  assert.throws(
    () => parseQuestionnaireCsv(new Uint8Array()),
    (error) =>
      error instanceof QuestionnaireCsvError &&
      error.code === "INVALID_INPUT" &&
      /must be a string/.test(error.message),
  );
});
