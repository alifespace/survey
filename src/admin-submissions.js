import {
  getQuestionnaire,
  QuestionnaireRepositoryError,
} from "./questionnaire-repository.js";
import {
  getSubmission,
  listSubmissions,
  StoredSubmissionError,
} from "./submission-repository.js";
import {
  exportSubmissionsCsv,
  SubmissionExportError,
} from "./submission-export.js";

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

function notFoundResponse() {
  return jsonResponse({ error: "Not found" }, 404);
}

async function questionnaireOrNull(env, surveyId) {
  try {
    return await getQuestionnaire(env.SURVEY_BUCKET, surveyId);
  } catch (error) {
    if (error instanceof TypeError) {
      return null;
    }
    throw error;
  }
}

export async function handleAdminSubmissionListRequest(request, env, surveyId) {
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405, { Allow: "GET" });
  }
  try {
    const questionnaire = await questionnaireOrNull(env, surveyId);
    if (questionnaire === null) {
      return notFoundResponse();
    }
    const cursorValue = new URL(request.url).searchParams.get("cursor");
    const result = await listSubmissions(env.SURVEY_BUCKET, questionnaire, {
      cursor: cursorValue === null ? undefined : cursorValue,
    });
    return jsonResponse({
      survey: {
        survey_id: questionnaire.metadata.survey_id,
        title: questionnaire.metadata.title,
      },
      submissions: result.submissions.map((submission) => ({
        submission_id: submission.submission_id,
        email: submission.email,
        submitted_at: submission.submitted_at,
      })),
      cursor: result.cursor,
    }, 200);
  } catch (error) {
    if (
      error instanceof StoredSubmissionError &&
      (error.code === "INVALID_CURSOR" || error.code === "INVALID_LIST_LIMIT")
    ) {
      return jsonResponse({ error: "Invalid list options", code: error.code }, 400);
    }
    if (
      error instanceof StoredSubmissionError ||
      error instanceof QuestionnaireRepositoryError
    ) {
      return jsonResponse({ error: "Submissions unavailable" }, 500);
    }
    throw error;
  }
}

export async function handleAdminSubmissionDetailRequest(
  request,
  env,
  surveyId,
  submissionId,
) {
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405, { Allow: "GET" });
  }
  const submittedAt = new URL(request.url).searchParams.get("submitted_at");
  if (submittedAt === null) {
    return notFoundResponse();
  }

  try {
    const questionnaire = await questionnaireOrNull(env, surveyId);
    if (questionnaire === null) {
      return notFoundResponse();
    }
    const submission = await getSubmission(
      env.SURVEY_BUCKET,
      questionnaire,
      submittedAt,
      submissionId,
    );
    if (submission === null) {
      return notFoundResponse();
    }
    return jsonResponse({
      survey: {
        survey_id: questionnaire.metadata.survey_id,
        title: questionnaire.metadata.title,
        questions: questionnaire.questions.map(({ question_id: questionId, label, type }) => ({
          question_id: questionId,
          label,
          type,
        })),
      },
      submission,
    }, 200);
  } catch (error) {
    if (error instanceof TypeError) {
      return notFoundResponse();
    }
    if (
      error instanceof StoredSubmissionError ||
      error instanceof QuestionnaireRepositoryError
    ) {
      return jsonResponse({ error: "Submission unavailable" }, 500);
    }
    throw error;
  }
}

export async function handleAdminSubmissionExportRequest(request, env, surveyId) {
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405, { Allow: "GET" });
  }
  try {
    const result = await exportSubmissionsCsv(env.SURVEY_BUCKET, surveyId);
    return new Response(result.csv, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="survey-${surveyId}-submissions.csv"`,
        "Content-Type": "text/csv; charset=utf-8",
      },
    });
  } catch (error) {
    if (error instanceof TypeError) {
      return notFoundResponse();
    }
    if (
      error instanceof SubmissionExportError &&
      error.code === "QUESTIONNAIRE_UNAVAILABLE"
    ) {
      return notFoundResponse();
    }
    if (
      error instanceof SubmissionExportError &&
      (error.code === "EXPORT_TOO_MANY_SUBMISSIONS" || error.code === "EXPORT_TOO_LARGE")
    ) {
      return jsonResponse({ error: "Export limit exceeded", code: error.code }, 413);
    }
    if (
      error instanceof StoredSubmissionError ||
      error instanceof QuestionnaireRepositoryError
    ) {
      return jsonResponse({ error: "Export unavailable" }, 500);
    }
    throw error;
  }
}
