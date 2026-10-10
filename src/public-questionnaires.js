import {
  listQuestionnaires,
  QuestionnaireRepositoryError,
} from "./questionnaire-repository.js";

function jsonResponse(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

export async function handlePublicQuestionnairesRequest(request, env) {
  if (request.method !== "GET") {
    return jsonResponse(
      { error: "Method not allowed" },
      405,
      { Allow: "GET" },
    );
  }

  const cursorValue = new URL(request.url).searchParams.get("cursor");
  const cursor = cursorValue === null ? undefined : cursorValue;

  try {
    const result = await listQuestionnaires(env.SURVEY_BUCKET, { cursor });
    return jsonResponse(
      {
        surveys: result.surveys.map(({ survey_id: surveyId, title }) => ({
          survey_id: surveyId,
          title,
        })),
        cursor: result.cursor,
      },
      200,
    );
  } catch (error) {
    if (
      error instanceof QuestionnaireRepositoryError &&
      error.code === "INVALID_CURSOR"
    ) {
      return jsonResponse(
        { error: "Invalid cursor", code: error.code },
        400,
      );
    }

    return jsonResponse({ error: "Questionnaires unavailable" }, 500);
  }
}
