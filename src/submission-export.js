import { getQuestionnaire } from "./questionnaire-repository.js";
import { listSubmissions } from "./submission-repository.js";

const UTF8_BOM = "\uFEFF";

export const EXPORT_LIMITS = Object.freeze({
  maxSubmissions: 1000,
  maxCsvBytes: 16 * 1024 * 1024,
});

export class SubmissionExportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SubmissionExportError";
    this.code = code;
  }
}

function csvCell(value) {
  const string = String(value);
  if (/[",\r\n]/u.test(string)) {
    return `"${string.replaceAll('"', '""')}"`;
  }
  return string;
}

export async function exportSubmissionsCsv(bucket, surveyId) {
  const questionnaire = await getQuestionnaire(bucket, surveyId);
  if (questionnaire === null) {
    throw new SubmissionExportError("QUESTIONNAIRE_UNAVAILABLE", "Questionnaire is unavailable");
  }

  const questionIds = questionnaire.questions.map(({ question_id: questionId }) => questionId);
  const rows = [["submission_id", "email", "submitted_at", ...questionIds].map(csvCell).join(",")];
  const encoder = new TextEncoder();
  let csvBytes = encoder.encode(UTF8_BOM + rows[0]).byteLength;
  let submissionCount = 0;
  let cursor;

  do {
    const page = await listSubmissions(bucket, questionnaire, {
      cursor,
      limit: 100,
    });
    for (const submission of page.submissions) {
      submissionCount += 1;
      if (submissionCount > EXPORT_LIMITS.maxSubmissions) {
        throw new SubmissionExportError(
          "EXPORT_TOO_MANY_SUBMISSIONS",
          `Export cannot exceed ${EXPORT_LIMITS.maxSubmissions} submissions`,
        );
      }
      const row = [
        submission.submission_id,
        submission.email,
        submission.submitted_at,
        ...questionIds.map((questionId) => {
          const answer = submission.answers[questionId];
          return Array.isArray(answer) ? answer.join("|") : answer;
        }),
      ].map(csvCell).join(",");
      csvBytes += 1 + encoder.encode(row).byteLength;
      if (csvBytes > EXPORT_LIMITS.maxCsvBytes) {
        throw new SubmissionExportError(
          "EXPORT_TOO_LARGE",
          `Export cannot exceed ${EXPORT_LIMITS.maxCsvBytes} bytes`,
        );
      }
      rows.push(row);
    }
    cursor = page.cursor ?? undefined;
  } while (cursor !== undefined);

  return {
    csv: UTF8_BOM + rows.join("\n"),
    title: questionnaire.metadata.title,
  };
}
