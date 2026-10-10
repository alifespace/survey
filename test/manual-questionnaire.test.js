import assert from "node:assert/strict";
import test from "node:test";

import {
  ManualQuestionnaireError,
  serializeManualQuestionnaire,
} from "../src/manual-questionnaire.js";
import {
  parseQuestionnaireCsv,
  QuestionnaireCsvError,
} from "../src/questionnaire-csv.js";

function validInput() {
  return {
    title: "Customer feedback",
    questions: [
      {
        type: "text",
        label: "Your name",
        required: true,
        options: [],
      },
      {
        type: "single_choice",
        label: "Choose a rating, then explain \"why\".\nOptional context is welcome.",
        required: false,
        options: ["Good", "Needs improvement"],
      },
    ],
  };
}

test("serializes a manual questionnaire into validated canonical CSV", () => {
  const result = serializeManualQuestionnaire(validInput());

  assert.equal(result.sourceFilename, "Customer feedback.csv");
  assert.match(result.csv, /^question_id,type,label,required,options\n/u);
  assert.match(result.csv, /^q1,text,Your name,true,$/mu);
  assert.match(
    result.csv,
    /"Choose a rating, then explain ""why""\.\nOptional context is welcome\."/u,
  );
  assert.deepEqual(parseQuestionnaireCsv(result.csv), {
    questionIdsGenerated: false,
    questions: [
      {
        question_id: "q1",
        type: "text",
        label: "Your name",
        required: true,
        options: [],
      },
      {
        question_id: "q2",
        type: "single_choice",
        label: "Choose a rating, then explain \"why\".\nOptional context is welcome.",
        required: false,
        options: ["Good", "Needs improvement"],
      },
    ],
  });
});

test("ignores any question_id sent by the client", () => {
  const input = validInput();
  input.questions[0].question_id = "invalid id";
  input.questions[1].question_id = "name";

  const result = serializeManualQuestionnaire(input);
  assert.deepEqual(
    parseQuestionnaireCsv(result.csv).questions.map(
      (question) => question.question_id,
    ),
    ["q1", "q2"],
  );
});

const invalidTitles = [
  "",
  "   ",
  "folder/survey",
  "folder\\survey",
  "survey\0title",
  "x".repeat(252),
];

for (const title of invalidTitles) {
  test(`rejects an invalid manual title: ${JSON.stringify(title)}`, () => {
    const input = validInput();
    input.title = title;
    assert.throws(
      () => serializeManualQuestionnaire(input),
      (error) =>
        error instanceof ManualQuestionnaireError &&
        error.code === "INVALID_TITLE",
    );
  });
}

test("rejects invalid structured question field types", () => {
  const input = validInput();
  input.questions[0].required = "true";
  assert.throws(
    () => serializeManualQuestionnaire(input),
    (error) =>
      error instanceof ManualQuestionnaireError &&
      error.code === "INVALID_QUESTION",
  );
});

test("rejects option values that cannot be represented by the CSV format", () => {
  const input = validInput();
  input.questions[1].options = ["Good|Bad"];
  assert.throws(
    () => serializeManualQuestionnaire(input),
    (error) =>
      error instanceof ManualQuestionnaireError &&
      error.code === "INVALID_QUESTION",
  );
});

const invalidQuestions = [
  {
    description: "no questions",
    change(input) {
      input.questions = [];
    },
    code: "NO_QUESTIONS",
  },
  {
    description: "unsupported type",
    change(input) {
      input.questions[0].type = "date";
    },
    code: "INVALID_TYPE",
  },
  {
    description: "options for a non-choice type",
    change(input) {
      input.questions[0].options = ["Unexpected"];
    },
    code: "INVALID_OPTIONS",
  },
  {
    description: "missing choice options",
    change(input) {
      input.questions[1].options = [];
    },
    code: "INVALID_OPTIONS",
  },
];

for (const { description, change, code } of invalidQuestions) {
  test(`reuses CSV validation for ${description}`, () => {
    const input = validInput();
    change(input);
    assert.throws(
      () => serializeManualQuestionnaire(input),
      (error) => error instanceof QuestionnaireCsvError && error.code === code,
    );
  });
}
