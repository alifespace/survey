const surveyId = new URLSearchParams(window.location.search).get("survey_id");
const heading = document.querySelector("#page-heading");
const exportButton = document.querySelector("#export-button");
const listStatus = document.querySelector("#list-status");
const submissionTable = document.querySelector("#submission-table");
const submissionList = document.querySelector("#submission-list");
const loadMoreButton = document.querySelector("#load-more-button");
const detailPanel = document.querySelector("#detail-panel");
const detailStatus = document.querySelector("#detail-status");
const detailList = document.querySelector("#detail-list");

let cursor = null;

function signInAgain() {
  window.location.assign("/admin.html");
}

async function apiError(response, fallback) {
  if (response.status === 401) {
    signInAgain();
    return "管理员登录已失效。";
  }
  if (response.status === 413) {
    return "答卷数量或导出文件超过 1.0 限制。";
  }
  return fallback;
}

function addSubmissionRows(submissions) {
  for (const submission of submissions) {
    const row = document.createElement("tr");
    const id = document.createElement("td");
    const email = document.createElement("td");
    const submitted = document.createElement("td");
    const actions = document.createElement("td");
    const viewButton = document.createElement("button");
    const deleteButton = document.createElement("button");
    id.className = "code";
    id.textContent = submission.submission_id;
    email.textContent = submission.email;
    submitted.textContent = new Date(submission.submitted_at).toLocaleString("zh-CN");
    actions.className = "row-actions";
    viewButton.type = "button";
    viewButton.className = "secondary compact";
    viewButton.textContent = "查看";
    viewButton.addEventListener("click", () => loadSubmission(submission));
    deleteButton.type = "button";
    deleteButton.className = "danger compact";
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", () => {
      deleteSubmission(submission, row, deleteButton);
    });
    actions.append(viewButton, deleteButton);
    row.append(id, email, submitted, actions);
    submissionList.append(row);
  }
}

async function deleteSubmission(submission, row, button) {
  const confirmed = window.confirm(
    `确定删除来自 ${submission.email} 的这份答卷吗？删除后无法恢复。`,
  );
  if (!confirmed) {
    return;
  }

  button.disabled = true;
  listStatus.className = "status";
  listStatus.textContent = "正在删除答卷……";
  try {
    const query = new URLSearchParams({ submitted_at: submission.submitted_at });
    const response = await fetch(
      `/api/admin/questionnaires/${encodeURIComponent(surveyId)}/submissions/${encodeURIComponent(submission.submission_id)}?${query}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      throw new Error(await apiError(response, "无法删除答卷。"));
    }
    row.remove();
    detailPanel.hidden = true;
    const count = submissionList.children.length;
    submissionTable.hidden = count === 0;
    listStatus.textContent = `已删除 1 份答卷，当前剩余 ${count} 份。`;
  } catch (error) {
    listStatus.className = "status error";
    listStatus.textContent = error.message;
    button.disabled = false;
  }
}

async function loadSubmissions({ append = false } = {}) {
  if (surveyId === null) {
    listStatus.className = "status error";
    listStatus.textContent = "缺少问卷 ID。";
    return;
  }
  listStatus.className = "status";
  listStatus.textContent = append ? "正在加载更多答卷……" : "正在加载答卷……";
  loadMoreButton.disabled = true;
  const query = append && cursor !== null
    ? `?${new URLSearchParams({ cursor })}`
    : "";
  try {
    const response = await fetch(
      `/api/admin/questionnaires/${encodeURIComponent(surveyId)}/submissions${query}`,
    );
    if (!response.ok) {
      throw new Error(await apiError(response, "无法加载答卷。"));
    }
    const result = await response.json();
    if (!append) {
      submissionList.replaceChildren();
      detailPanel.hidden = true;
    }
    heading.textContent = result.survey.title;
    document.title = `${result.survey.title}－答卷管理`;
    addSubmissionRows(result.submissions);
    cursor = result.cursor;
    const count = submissionList.children.length;
    submissionTable.hidden = count === 0;
    loadMoreButton.hidden = cursor === null;
    exportButton.disabled = false;
    listStatus.textContent = count === 0 ? "尚未收到答卷。" : `已加载 ${count} 份答卷。`;
  } catch (error) {
    listStatus.className = "status error";
    listStatus.textContent = error.message;
  } finally {
    loadMoreButton.disabled = false;
  }
}

async function loadSubmission(submission) {
  detailPanel.hidden = false;
  detailStatus.className = "status";
  detailStatus.textContent = "正在加载答卷详情……";
  detailList.replaceChildren();
  const query = new URLSearchParams({ submitted_at: submission.submitted_at });
  try {
    const response = await fetch(
      `/api/admin/questionnaires/${encodeURIComponent(surveyId)}/submissions/${encodeURIComponent(submission.submission_id)}?${query}`,
    );
    if (!response.ok) {
      throw new Error(await apiError(response, "无法加载答卷详情。"));
    }
    const result = await response.json();
    const fields = [
      ["答卷 ID", result.submission.submission_id],
      ["Email", result.submission.email],
      ["提交时间", new Date(result.submission.submitted_at).toLocaleString("zh-CN")],
      ...result.survey.questions.map((question) => {
        const answer = result.submission.answers[question.question_id];
        return [question.label, Array.isArray(answer) ? answer.join("、") : answer];
      }),
    ];
    for (const [label, answer] of fields) {
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = label;
      description.textContent = answer === "" ? "未填写" : answer;
      if (answer === "") {
        description.className = "empty";
      }
      detailList.append(term, description);
    }
    detailStatus.textContent = "";
    detailPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    detailStatus.className = "status error";
    detailStatus.textContent = error.message;
  }
}

async function exportCsv() {
  exportButton.disabled = true;
  listStatus.className = "status";
  listStatus.textContent = "正在生成 CSV……";
  try {
    const response = await fetch(
      `/api/admin/questionnaires/${encodeURIComponent(surveyId)}/submissions.csv`,
    );
    if (!response.ok) {
      throw new Error(await apiError(response, "无法导出 CSV。"));
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `survey-${surveyId}-submissions.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    listStatus.textContent = "CSV 已生成。";
  } catch (error) {
    listStatus.className = "status error";
    listStatus.textContent = error.message;
  } finally {
    exportButton.disabled = false;
  }
}

document.querySelector("#refresh-button").addEventListener("click", () => loadSubmissions());
loadMoreButton.addEventListener("click", () => loadSubmissions({ append: true }));
exportButton.addEventListener("click", exportCsv);

const sessionResponse = await fetch("/api/admin/session");
if (!sessionResponse.ok) {
  signInAgain();
} else {
  await loadSubmissions();
}
