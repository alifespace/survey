import assert from "node:assert/strict";
import test from "node:test";

import {
  isValidEmail,
  loadAvailableQuestionnaires,
  loadQuestionnaire,
  submitQuestionnaire,
} from "../public/questionnaire-api.js";

test("loads every questionnaire page using opaque cursors", async () => {
  const calls = [];
  const fetchFunction = async (url) => {
    calls.push(url);
    const secondPage = url.includes("cursor=next-page");
    return Response.json({
      surveys: [
        {
          survey_id: secondPage ? "survey-2" : "survey-1",
          title: secondPage ? "Second" : "First",
        },
      ],
      cursor: secondPage ? null : "next-page",
    });
  };

  assert.deepEqual(await loadAvailableQuestionnaires(fetchFunction), [
    { survey_id: "survey-1", title: "First" },
    { survey_id: "survey-2", title: "Second" },
  ]);
  assert.deepEqual(calls, [
    "/api/questionnaires",
    "/api/questionnaires?cursor=next-page",
  ]);
});

test("rejects failed and malformed questionnaire list responses", async () => {
  await assert.rejects(
    loadAvailableQuestionnaires(async () => new Response(null, { status: 500 })),
    /QUESTIONNAIRE_LIST_UNAVAILABLE/u,
  );
  await assert.rejects(
    loadAvailableQuestionnaires(async () => Response.json({ surveys: null, cursor: null })),
    /INVALID_QUESTIONNAIRE_LIST/u,
  );
  await assert.rejects(
    loadAvailableQuestionnaires(async () => Response.json({
      surveys: [],
      cursor: "repeated",
    })),
    /INVALID_QUESTIONNAIRE_CURSOR/u,
  );
});

test("uses the same customer email boundary as the Worker", () => {
  assert.equal(isValidEmail(" person@example.com "), true);
  assert.equal(isValidEmail("person@example"), false);
  assert.equal(isValidEmail("person@@example.com"), false);
  assert.equal(isValidEmail(`person@${"x".repeat(250)}.com`), false);
});

test("loads and validates a public questionnaire", async () => {
  const surveyId = "123e4567-e89b-42d3-a456-426614174000";
  const survey = await loadQuestionnaire(surveyId, async (url) => {
    assert.equal(url, `/api/questionnaires/${surveyId}`);
    return Response.json({
      survey: {
        survey_id: surveyId,
        title: "Survey",
        questions: [
          {
            question_id: "name",
            type: "text",
            label: "Name",
            required: true,
            options: [],
          },
        ],
      },
    });
  });
  assert.equal(survey.questions[0].question_id, "name");

  await assert.rejects(
    loadQuestionnaire(surveyId, async () => Response.json({ survey: null })),
    /INVALID_QUESTIONNAIRE/u,
  );
});

test("submits answers and validates the public response", async () => {
  const surveyId = "123e4567-e89b-42d3-a456-426614174000";
  const input = { email: "person@example.com", answers: { name: "Person" } };
  const result = await submitQuestionnaire(surveyId, input, async (url, options) => {
    assert.equal(url, `/api/questionnaires/${surveyId}/submissions`);
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), input);
    return Response.json({
      submission: {
        submission_id: "987e6543-e21b-42d3-b456-426614174999",
        submitted_at: "2026-10-10T01:02:03.004Z",
      },
    }, { status: 201 });
  });
  assert.equal(result.submission_id, "987e6543-e21b-42d3-b456-426614174999");
});
