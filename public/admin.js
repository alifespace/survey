const MAX_CSV_BYTES = 256 * 1024;
const MAX_QUESTIONS = 200;
const CHOICE_TYPES = new Set(["single_choice", "multi_choice"]);
const ERROR_MESSAGES = Object.freeze({
  CSV_SYNTAX_ERROR: "CSV 格式不正确，请检查引号和换行。",
  CSV_TOO_LARGE: "问卷 CSV 不能超过 256 KiB。",
  DUPLICATE_QUESTION_ID: "题目 ID 不能重复。",
  INVALID_COLUMN_COUNT: "CSV 每行必须包含 5 列。",
  INVALID_CURSOR: "问卷列表分页参数无效。",
  INVALID_HEADER: "CSV 表头必须为 question_id,type,label,required,options，并保持该顺序。",
  INVALID_INPUT: "问卷数据格式无效。",
  INVALID_JSON: "提交的数据不是有效的 JSON。",
  INVALID_LABEL: "题目文字不能为空，且不能超过 1000 个字符。",
  INVALID_LIST_LIMIT: "问卷列表数量参数无效。",
  INVALID_OPTIONS: "请选择题必须填写有效选项，非选择题不能填写选项。",
  INVALID_QUESTION: "题目字段格式无效。",
  INVALID_QUESTION_ID: "题目 ID 只能包含英文字母、数字、下划线和连字符，最多 64 个字符。",
  INVALID_QUESTIONS: "题目列表格式无效。",
  INVALID_REQUIRED: "CSV 的 required 必须为小写 true 或 false。",
  INVALID_SOURCE_FILENAME: "文件名必须以 .csv 结尾，且不能包含路径或控制字符。",
  INVALID_TITLE: "问卷标题不能为空、不能超过 251 个字符，也不能包含路径或控制字符。",
  INVALID_TYPE: "题型不受支持。",
  INVALID_UPLOAD: "请选择有效的 CSV 文件。",
  NO_QUESTIONS: "问卷至少需要一道题。",
  QUESTIONNAIRE_ALREADY_EXISTS: "问卷创建冲突，请重试。",
  TOO_MANY_QUESTIONS: "每份问卷最多包含 200 道题。",
});

const loginView = document.querySelector("#login-view");
const adminView = document.querySelector("#admin-view");
const loginForm = document.querySelector("#login-form");
const loginStatus = document.querySelector("#login-status");
const uploadForm = document.querySelector("#upload-form");
const uploadStatus = document.querySelector("#upload-status");
const manualForm = document.querySelector("#manual-form");
const manualStatus = document.querySelector("#manual-status");
const questions = document.querySelector("#questions");
const questionTemplate = document.querySelector("#question-template");
const surveyTable = document.querySelector("#survey-table");
const surveyList = document.querySelector("#survey-list");
const listStatus = document.querySelector("#list-status");
const loadMoreButton = document.querySelector("#load-more-button");

let listCursor = null;

function setStatus(element, message, kind = "") {
  element.textContent = message;
  element.className = `status${kind ? ` ${kind}` : ""}`;
}

async function responseError(response) {
  try {
    const body = await response.json();
    if (typeof body.code === "string" && ERROR_MESSAGES[body.code] !== undefined) {
      const row = typeof body.error === "string"
        ? body.error.match(/^Row (\d+):/u)?.[1]
        : undefined;
      return `${row === undefined ? "" : `第 ${row} 行：`}${ERROR_MESSAGES[body.code]}`;
    }
  } catch {
    return "请求失败，请稍后重试。";
  }

  if (response.status === 401) {
    return "管理员登录已失效，请重新登录。";
  }
  if (response.status === 413) {
    return "提交的数据过大。";
  }
  if (response.status === 415) {
    return "提交的数据格式不受支持。";
  }
  return "请求失败，请稍后重试。";
}

function setAuthenticated(authenticated) {
  loginView.hidden = authenticated;
  adminView.hidden = !authenticated;
  if (!authenticated) {
    document.querySelector("#password").focus();
  }
}

function updateQuestionControls() {
  const cards = [...questions.querySelectorAll(".question-card")];
  cards.forEach((card, index) => {
    card.querySelector(".question-number").textContent = String(index + 1);
    card.querySelector(".move-up").disabled = index === 0;
    card.querySelector(".move-down").disabled = index === cards.length - 1;
    card.querySelector(".remove").disabled = cards.length === 1;
  });
}

function updateOptions(card) {
  const type = card.querySelector(".question-type").value;
  const optionsLabel = card.querySelector(".options-label");
  const optionsInput = card.querySelector(".question-options");
  const isChoice = CHOICE_TYPES.has(type);
  optionsLabel.hidden = !isChoice;
  optionsInput.required = isChoice;
  if (!isChoice) {
    optionsInput.value = "";
  }
}

function addQuestion() {
  if (questions.children.length >= MAX_QUESTIONS) {
    setStatus(manualStatus, `每份问卷最多包含 ${MAX_QUESTIONS} 道题。`, "error");
    return;
  }

  const card = questionTemplate.content.firstElementChild.cloneNode(true);
  card.querySelector(".question-type").addEventListener("change", () => updateOptions(card));
  card.querySelector(".move-up").addEventListener("click", () => {
    const previous = card.previousElementSibling;
    if (previous !== null) {
      questions.insertBefore(card, previous);
      updateQuestionControls();
    }
  });
  card.querySelector(".move-down").addEventListener("click", () => {
    const next = card.nextElementSibling;
    if (next !== null) {
      questions.insertBefore(next, card);
      updateQuestionControls();
    }
  });
  card.querySelector(".remove").addEventListener("click", () => {
    card.remove();
    updateQuestionControls();
  });
  questions.append(card);
  updateOptions(card);
  updateQuestionControls();
}

function manualPayload() {
  return {
    title: document.querySelector("#survey-title").value,
    questions: [...questions.querySelectorAll(".question-card")].map((card) => {
      const type = card.querySelector(".question-type").value;
      const optionsValue = card.querySelector(".question-options").value;
      return {
        question_id: card.querySelector(".question-id").value,
        type,
        label: card.querySelector(".question-label").value,
        required: card.querySelector(".question-required").checked,
        options: CHOICE_TYPES.has(type)
          ? optionsValue.split("|").map((option) => option.trim())
          : [],
      };
    }),
  };
}

function addSurveyRows(surveys) {
  for (const survey of surveys) {
    const row = document.createElement("tr");
    const title = document.createElement("td");
    const id = document.createElement("td");
    const created = document.createElement("td");
    const actions = document.createElement("td");
    const submissionsLink = document.createElement("a");
    title.textContent = survey.title;
    id.textContent = survey.survey_id;
    id.className = "code";
    created.textContent = new Date(survey.created_at).toLocaleString("zh-CN");
    submissionsLink.className = "button-link";
    submissionsLink.href = `/admin-submissions.html?${new URLSearchParams({ survey_id: survey.survey_id })}`;
    submissionsLink.textContent = "查看答卷";
    actions.append(submissionsLink);
    row.append(title, id, created, actions);
    surveyList.append(row);
  }
}

async function loadSurveys({ append = false } = {}) {
  setStatus(listStatus, append ? "正在加载更多问卷……" : "正在加载问卷……");
  loadMoreButton.disabled = true;
  const query = append && listCursor !== null
    ? `?${new URLSearchParams({ cursor: listCursor })}`
    : "";

  try {
    const response = await fetch(`/api/admin/questionnaires${query}`);
    if (response.status === 401) {
      setAuthenticated(false);
      setStatus(
        loginStatus,
        "登录状态不可用或已过期。本地开发请使用 HTTPS，然后重新登录。",
        "error",
      );
      return;
    }
    if (!response.ok) {
      throw new Error(await responseError(response));
    }

    const result = await response.json();
    if (!append) {
      surveyList.replaceChildren();
    }
    addSurveyRows(result.surveys);
    listCursor = result.cursor;
    const count = surveyList.children.length;
    surveyTable.hidden = count === 0;
    loadMoreButton.hidden = listCursor === null;
    setStatus(
      listStatus,
      count === 0 ? "尚未创建问卷。" : `已加载 ${count} 份问卷。`,
    );
  } catch (error) {
    setStatus(listStatus, error.message, "error");
  } finally {
    loadMoreButton.disabled = false;
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = loginForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  setStatus(loginStatus, "正在登录……");
  try {
    const response = await fetch("/api/admin/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: document.querySelector("#password").value }),
    });
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("密码错误，请重试。");
      }
      throw new Error(await responseError(response));
    }
    loginForm.reset();
    setStatus(loginStatus, "");
    setAuthenticated(true);
    await loadSurveys();
  } catch (error) {
    setStatus(loginStatus, error.message, "error");
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  await fetch("/api/admin/session", { method: "DELETE" });
  setAuthenticated(false);
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = document.querySelector("#csv-file").files[0];
  if (file === undefined) {
    setStatus(uploadStatus, "请选择 CSV 文件。", "error");
    return;
  }
  if (file.size > MAX_CSV_BYTES) {
    setStatus(uploadStatus, `问卷 CSV 不能超过 ${MAX_CSV_BYTES} bytes。`, "error");
    return;
  }

  const submitButton = uploadForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  setStatus(uploadStatus, "正在上传问卷……");
  try {
    const body = new FormData();
    body.append("file", file);
    const response = await fetch("/api/admin/questionnaires", { method: "POST", body });
    if (!response.ok) {
      throw new Error(await responseError(response));
    }
    uploadForm.reset();
    setStatus(uploadStatus, "问卷上传成功。", "success");
    await loadSurveys();
  } catch (error) {
    setStatus(uploadStatus, error.message, "error");
  } finally {
    submitButton.disabled = false;
  }
});

manualForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = manualForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  setStatus(manualStatus, "正在创建问卷……");
  try {
    const response = await fetch("/api/admin/questionnaires", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(manualPayload()),
    });
    if (!response.ok) {
      throw new Error(await responseError(response));
    }
    manualForm.reset();
    questions.replaceChildren();
    addQuestion();
    setStatus(manualStatus, "问卷创建成功。", "success");
    await loadSurveys();
  } catch (error) {
    setStatus(manualStatus, error.message, "error");
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector("#add-question-button").addEventListener("click", addQuestion);
document.querySelector("#refresh-button").addEventListener("click", () => loadSurveys());
loadMoreButton.addEventListener("click", () => loadSurveys({ append: true }));

addQuestion();

try {
  const response = await fetch("/api/admin/session");
  const authenticated = response.ok;
  setAuthenticated(authenticated);
  if (authenticated) {
    await loadSurveys();
  }
} catch {
  setAuthenticated(false);
  setStatus(loginStatus, "无法连接服务器。", "error");
}
