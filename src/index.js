import {
  handleAdminSessionRequest,
  requireAdminSession,
} from "./admin-auth.js";
import {
  handleAdminQuestionnaireDetailRequest,
  handleAdminQuestionnairesRequest,
} from "./admin-questionnaires.js";
import {
  handleAdminSubmissionDetailRequest,
  handleAdminSubmissionExportRequest,
  handleAdminSubmissionListRequest,
} from "./admin-submissions.js";
import { handlePublicQuestionnairesRequest } from "./public-questionnaires.js";
import {
  handlePublicQuestionnaireRequest,
  handlePublicSubmissionRequest,
} from "./public-survey.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/health") {
      return Response.json({ status: "ok" });
    }

    if (url.pathname === "/api/questionnaires") {
      return handlePublicQuestionnairesRequest(request, env);
    }

    const submissionMatch = url.pathname.match(
      /^\/api\/questionnaires\/([^/]+)\/submissions$/u,
    );
    if (submissionMatch !== null) {
      return handlePublicSubmissionRequest(request, env, submissionMatch[1]);
    }

    const questionnaireMatch = url.pathname.match(
      /^\/api\/questionnaires\/([^/]+)$/u,
    );
    if (questionnaireMatch !== null) {
      return handlePublicQuestionnaireRequest(request, env, questionnaireMatch[1]);
    }

    if (url.pathname === "/api/admin/session") {
      return handleAdminSessionRequest(request, env);
    }

    if (
      url.pathname === "/api/admin" ||
      url.pathname.startsWith("/api/admin/")
    ) {
      const rejected = await requireAdminSession(request, env);
      if (rejected !== null) {
        return rejected;
      }
    }

    if (url.pathname === "/api/admin/questionnaires") {
      return handleAdminQuestionnairesRequest(request, env);
    }

    const adminQuestionnaireMatch = url.pathname.match(
      /^\/api\/admin\/questionnaires\/([^/]+)$/u,
    );
    if (adminQuestionnaireMatch !== null) {
      return handleAdminQuestionnaireDetailRequest(
        request,
        env,
        adminQuestionnaireMatch[1],
      );
    }

    const adminExportMatch = url.pathname.match(
      /^\/api\/admin\/questionnaires\/([^/]+)\/submissions\.csv$/u,
    );
    if (adminExportMatch !== null) {
      return handleAdminSubmissionExportRequest(request, env, adminExportMatch[1]);
    }

    const adminSubmissionMatch = url.pathname.match(
      /^\/api\/admin\/questionnaires\/([^/]+)\/submissions\/([^/]+)$/u,
    );
    if (adminSubmissionMatch !== null) {
      return handleAdminSubmissionDetailRequest(
        request,
        env,
        adminSubmissionMatch[1],
        adminSubmissionMatch[2],
      );
    }

    const adminSubmissionListMatch = url.pathname.match(
      /^\/api\/admin\/questionnaires\/([^/]+)\/submissions$/u,
    );
    if (adminSubmissionListMatch !== null) {
      return handleAdminSubmissionListRequest(
        request,
        env,
        adminSubmissionListMatch[1],
      );
    }

    return new Response("Not Found", { status: 404 });
  },
};
