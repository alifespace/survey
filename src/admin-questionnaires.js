import {
  createQuestionnaire,
  listQuestionnaires,
  QuestionnaireRepositoryError,
} from "./questionnaire-repository.js";
import {
  QuestionnaireCsvError,
  QUESTIONNAIRE_LIMITS,
} from "./questionnaire-csv.js";
import {
  ManualQuestionnaireError,
  serializeManualQuestionnaire,
} from "./manual-questionnaire.js";

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

function clientError(error) {
  return jsonResponse(
    {
      error: error.message,
      code: error.code,
    },
    400,
  );
}

function parseListOptions(url) {
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limitValue = url.searchParams.get("limit");
  const limit = limitValue === null ? undefined : Number(limitValue);
  return { cursor, limit };
}

async function readCsvUpload(request) {
  let form;
  try {
    form = await request.formData();
  } catch {
    throw new QuestionnaireRepositoryError(
      "INVALID_UPLOAD",
      "Upload must be valid multipart form data",
    );
  }

  const file = form.get("file");
  if (
    file === null ||
    typeof file !== "object" ||
    typeof file.name !== "string" ||
    typeof file.size !== "number" ||
    typeof file.text !== "function"
  ) {
    throw new QuestionnaireRepositoryError(
      "INVALID_UPLOAD",
      "A CSV file is required",
    );
  }

  if (file.size > QUESTIONNAIRE_LIMITS.maxCsvBytes) {
    throw new QuestionnaireCsvError(
      "CSV_TOO_LARGE",
      `Questionnaire CSV must not exceed ${QUESTIONNAIRE_LIMITS.maxCsvBytes} bytes`,
    );
  }

  return {
    csv: await file.text(),
    sourceFilename: file.name,
  };
}

async function readManualQuestionnaire(request) {
  let input;
  try {
    input = await request.json();
  } catch {
    throw new ManualQuestionnaireError(
      "INVALID_JSON",
      "Request body must be valid JSON",
    );
  }
  return serializeManualQuestionnaire(input);
}

async function createFromRequest(request, bucket) {
  const contentType = (request.headers.get("Content-Type") ?? "").toLowerCase();
  let questionnaire;

  if (contentType.startsWith("multipart/form-data")) {
    questionnaire = await readCsvUpload(request);
  } else if (contentType.startsWith("application/json")) {
    questionnaire = await readManualQuestionnaire(request);
  } else {
    return jsonResponse(
      { error: "Content-Type must be application/json or multipart/form-data" },
      415,
    );
  }

  const survey = await createQuestionnaire(bucket, questionnaire);
  return jsonResponse({ survey }, 201);
}

export async function handleAdminQuestionnairesRequest(request, env) {
  if (request.method === "GET") {
    try {
      const result = await listQuestionnaires(
        env.SURVEY_BUCKET,
        parseListOptions(new URL(request.url)),
      );
      return jsonResponse(result, 200);
    } catch (error) {
      if (
        error instanceof QuestionnaireRepositoryError &&
        (error.code === "INVALID_LIST_LIMIT" || error.code === "INVALID_CURSOR")
      ) {
        return clientError(error);
      }
      throw error;
    }
  }

  if (request.method === "POST") {
    try {
      return await createFromRequest(request, env.SURVEY_BUCKET);
    } catch (error) {
      if (
        error instanceof QuestionnaireCsvError ||
        error instanceof ManualQuestionnaireError ||
        (error instanceof QuestionnaireRepositoryError &&
          (error.code === "INVALID_SOURCE_FILENAME" ||
            error.code === "INVALID_UPLOAD"))
      ) {
        return clientError(error);
      }
      if (
        error instanceof QuestionnaireRepositoryError &&
        error.code === "QUESTIONNAIRE_ALREADY_EXISTS"
      ) {
        return jsonResponse(
          { error: "Questionnaire could not be created", code: error.code },
          409,
        );
      }
      throw error;
    }
  }

  return jsonResponse(
    { error: "Method not allowed" },
    405,
    { Allow: "GET, POST" },
  );
}
