import {
  getQuestionnaire,
  QuestionnaireRepositoryError,
} from "./questionnaire-repository.js";
import {
  createSubmission,
  SubmissionError,
} from "./submission-repository.js";

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

function unavailableResponse() {
  return jsonResponse({ error: "Questionnaire unavailable" }, 404);
}

function invalidSubmissionResponse(error) {
  return jsonResponse({ error: "Invalid submission", code: error.code }, 400);
}

async function readSubmission(request) {
  const contentType = (request.headers.get("Content-Type") ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw new SubmissionError("INVALID_CONTENT_TYPE", "Content-Type must be application/json");
  }

  let input;
  try {
    input = await request.json();
  } catch {
    throw new SubmissionError("INVALID_JSON", "Request body must be valid JSON");
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new SubmissionError("INVALID_SUBMISSION", "Submission must be an object");
  }
  if (Object.keys(input).some((key) => key !== "email" && key !== "answers")) {
    throw new SubmissionError("UNKNOWN_SUBMISSION_FIELD", "Submission contains an unknown field");
  }
  return input;
}

export async function handlePublicQuestionnaireRequest(request, env, surveyId) {
  if (request.method !== "GET") {
    return jsonResponse(
      { error: "Method not allowed" },
      405,
      { Allow: "GET" },
    );
  }

  try {
    const questionnaire = await getQuestionnaire(env.SURVEY_BUCKET, surveyId);
    if (questionnaire === null) {
      return unavailableResponse();
    }
    return jsonResponse({
      survey: {
        survey_id: questionnaire.metadata.survey_id,
        title: questionnaire.metadata.title,
        questions: questionnaire.questions,
      },
    }, 200);
  } catch (error) {
    if (error instanceof TypeError) {
      return unavailableResponse();
    }
    if (error instanceof QuestionnaireRepositoryError) {
      return jsonResponse({ error: "Questionnaire unavailable" }, 500);
    }
    throw error;
  }
}

export async function handlePublicSubmissionRequest(request, env, surveyId) {
  if (request.method !== "POST") {
    return jsonResponse(
      { error: "Method not allowed" },
      405,
      { Allow: "POST" },
    );
  }

  try {
    const input = await readSubmission(request);
    const submission = await createSubmission(
      env.SURVEY_BUCKET,
      surveyId,
      input,
    );
    return jsonResponse({
      submission: {
        submission_id: submission.submission_id,
        submitted_at: submission.submitted_at,
      },
    }, 201);
  } catch (error) {
    if (error instanceof TypeError) {
      return unavailableResponse();
    }
    if (error instanceof SubmissionError) {
      if (error.code === "QUESTIONNAIRE_UNAVAILABLE") {
        return unavailableResponse();
      }
      if (error.code === "SUBMISSION_ALREADY_EXISTS") {
        return jsonResponse(
          { error: "Submission conflict", code: error.code },
          409,
        );
      }
      return invalidSubmissionResponse(error);
    }
    if (error instanceof QuestionnaireRepositoryError) {
      return jsonResponse({ error: "Questionnaire unavailable" }, 500);
    }
    throw error;
  }
}
