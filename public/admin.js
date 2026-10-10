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
const editorForm = document.querySelector("#editor-form");
const editorStatus = document.querySelector("#editor-status");
const editorHeading = document.querySelector("#editor-heading");
const editorModeBanner = document.querySelector("#editor-mode-banner");
const saveButton = document.querySelector("#save-button");
const cancelButton = document.querySelector("#cancel-editor-button");
const titleInput = document.querySelector("#survey-title");
const questions = document.querySelector("#questions");
const questionTemplate = document.querySelector("#question-template");
const surveyTable = document.querySelector("#survey-table");
const surveyList = document.querySelector("#survey-list");
const listStatus = document.querySelector("#list-status");
const loadMoreButton = document.querySelector("#load-more-button");
const detailPanel = document.querySelector("#questionnaire-detail-panel");
const detailSubtitle = document.querySelector("#questionnaire-detail-subtitle");
const detailStatus = document.querySelector("#questionnaire-detail-status");
const detailList = document.querySelector("#questionnaire-detail-list");

const QUESTION_TYPE_NAMES = Object.freeze({
  text: "单行文本",
  textarea: "多行文本",
  email: "Email",
  number: "数字",
  single_choice: "单选",
  multi_choice: "多选",
});

let listCursor = null;
let editorMode = "create";
let activeEditorSurveyId = null;

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

function addQuestion(question = null, afterCard = null) {
  if (questions.children.length >= MAX_QUESTIONS) {
    setStatus(editorStatus, `每份问卷最多包含 ${MAX_QUESTIONS} 道题。`, "error");
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
  card.querySelector(".add-after").addEventListener("click", () => {
    addQuestion(null, card);
  });
  card.querySelector(".remove").addEventListener("click", () => {
    card.remove();
    updateQuestionControls();
  });

  if (question !== null) {
    card.querySelector(".question-type").value = question.type;
    card.querySelector(".question-label").value = question.label;
    card.querySelector(".question-required").checked = question.required;
    if (typeof question.question_id === "string" && question.question_id !== "") {
      card.dataset.questionId = question.question_id;
    }
  }

  if (afterCard !== null && afterCard.parentElement === questions) {
    afterCard.after(card);
  } else {
    questions.append(card);
  }

  updateOptions(card);
  if (question !== null && CHOICE_TYPES.has(question.type)) {
    card.querySelector(".question-options").value = question.options.join("|");
  }
  updateQuestionControls();
  card.querySelector(".question-label").focus();
}

function editorPayload({ includeQuestionIds = false } = {}) {
  return {
    title: titleInput.value,
    questions: [...questions.querySelectorAll(".question-card")].map((card) => {
      const type = card.querySelector(".question-type").value;
      const optionsValue = card.querySelector(".question-options").value;
      const question = {
        type,
        label: card.querySelector(".question-label").value,
        required: card.querySelector(".question-required").checked,
        options: CHOICE_TYPES.has(type)
          ? optionsValue.split("|").map((option) => option.trim())
          : [],
      };
      if (includeQuestionIds && card.dataset.questionId !== undefined) {
        question.question_id = card.dataset.questionId;
      }
      return question;
    }),
  };
}

function characterCount(value) {
  return Array.from(value).length;
}

function validateEditor() {
  const title = titleInput.value;
  if (title.trim() === "") {
    return "请填写问卷标题。";
  }
  if (characterCount(title) > 251) {
    return "问卷标题不能超过 251 个字符。";
  }
  if (/[/\\\0-\x1F\x7F]/u.test(title)) {
    return "问卷标题不能包含路径分隔符或控制字符。";
  }

  const cards = [...questions.querySelectorAll(".question-card")];
  if (cards.length === 0) {
    return "问卷至少需要一道题。";
  }
  if (cards.length > MAX_QUESTIONS) {
    return `每份问卷最多包含 ${MAX_QUESTIONS} 道题。`;
  }

  for (let index = 0; index < cards.length; index += 1) {
    const position = index + 1;
    const label = cards[index].querySelector(".question-label").value;
    if (label.trim() === "") {
      return `第 ${position} 道题的题目文字不能为空。`;
    }
    if (characterCount(label) > 1000) {
      return `第 ${position} 道题的题目文字不能超过 1000 个字符。`;
    }

    const type = cards[index].querySelector(".question-type").value;
    if (CHOICE_TYPES.has(type)) {
      const options = cards[index]
        .querySelector(".question-options")
        .value.split("|")
        .map((option) => option.trim());
      if (options.some((option) => option === "")) {
        return `第 ${position} 道题需要填写有效选项。`;
      }
      if (options.length > 50) {
        return `第 ${position} 道题最多包含 50 个选项。`;
      }
      if (options.some((option) => characterCount(option) > 200)) {
        return `第 ${position} 道题的每个选项不能超过 200 个字符。`;
      }
    }
  }

  return null;
}

function updateEditorModeUi(sourceTitle) {
  const copying = editorMode === "copy";
  const editing = editorMode === "edit";
  editorHeading.textContent = copying
    ? "复制问卷"
    : editing
      ? "编辑问卷"
      : "创建问卷";
  saveButton.textContent = copying
    ? "保存副本"
    : editing
      ? "保存修改"
      : "创建问卷";
  cancelButton.hidden = !(copying || editing);
  editorModeBanner.hidden = !(copying || editing);
  if (copying) {
    editorModeBanner.textContent = `正在以《${sourceTitle}》为模板复制：保存后将创建新的独立问卷，不会复制答卷。`;
  } else if (editing) {
    editorModeBanner.textContent = `正在编辑《${sourceTitle}》：保存后将覆盖该问卷的定义（仅无答卷问卷可以保存）。`;
  } else {
    editorModeBanner.textContent = "";
  }
}

function clearEditorParams() {
  const url = new URL(window.location.href);
  let changed = false;
  for (const parameter of ["copy", "edit"]) {
    if (url.searchParams.has(parameter)) {
      url.searchParams.delete(parameter);
      changed = true;
    }
  }
  if (changed) {
    window.history.replaceState(null, "", url);
  }
}

function resetToCreateMode() {
  editorMode = "create";
  activeEditorSurveyId = null;
  editorForm.reset();
  questions.replaceChildren();
  addQuestion();
  updateEditorModeUi();
  clearEditorParams();
}

function applyPrefilledMode(mode, survey) {
  editorMode = mode;
  activeEditorSurveyId = mode === "edit" ? survey.survey_id : null;
  titleInput.value = survey.title;
  questions.replaceChildren();
  for (const question of survey.questions) {
    addQuestion(question);
  }
  updateEditorModeUi(survey.title);
  setStatus(editorStatus, "");
}

async function loadQuestionnaireIntoEditor(surveyId, mode) {
  const loadingText = mode === "edit" ? "正在载入要编辑的问卷……" : "正在载入来源问卷……";
  setStatus(editorStatus, loadingText);
  try {
    const response = await fetch(
      `/api/admin/questionnaires/${encodeURIComponent(surveyId)}`,
    );
    if (response.status === 401) {
      setAuthenticated(false);
      setStatus(
        loginStatus,
        "登录状态不可用或已过期。本地开发请使用 HTTPS，然后重新登录。",
        "error",
      );
      return;
    }
    if (response.status === 404) {
      resetToCreateMode();
      setStatus(editorStatus, "来源问卷不存在或不可读取。", "error");
      return;
    }
    if (!response.ok) {
      throw new Error(await responseError(response));
    }
    const result = await response.json();
    if (
      result?.survey === null ||
      typeof result?.survey !== "object" ||
      typeof result.survey.title !== "string" ||
      !Array.isArray(result.survey.questions)
    ) {
      throw new Error("来源问卷数据无效。");
    }
    applyPrefilledMode(mode, result.survey);
  } catch (error) {
    resetToCreateMode();
    setStatus(editorStatus, error.message, "error");
  }
}

function enterCopyMode(surveyId) {
  return loadQuestionnaireIntoEditor(surveyId, "copy");
}

function enterEditMode(surveyId) {
  return loadQuestionnaireIntoEditor(surveyId, "edit");
}

function addSurveyRows(surveys) {
  for (const survey of surveys) {
    const row = document.createElement("tr");
    const title = document.createElement("td");
    const id = document.createElement("td");
    const created = document.createElement("td");
    const actions = document.createElement("td");
    title.textContent = survey.title;
    id.textContent = survey.survey_id;
    id.className = "code";
    created.textContent = new Date(survey.created_at).toLocaleString("zh-CN");
    actions.className = "row-actions";

    if (survey.has_submissions) {
      const submissionsLink = document.createElement("a");
      submissionsLink.className = "button-link";
      submissionsLink.href = `/admin-submissions.html?${new URLSearchParams({ survey_id: survey.survey_id })}`;
      submissionsLink.textContent = "查看答卷";
      actions.append(submissionsLink);
    } else {
      const disabledSubmissions = document.createElement("span");
      disabledSubmissions.className = "button-link disabled";
      disabledSubmissions.textContent = "查看答卷";
      disabledSubmissions.title = "该问卷暂无答卷。";
      disabledSubmissions.setAttribute("aria-disabled", "true");
      actions.append(disabledSubmissions);
    }

    const viewButton = document.createElement("button");
    viewButton.type = "button";
    viewButton.className = "secondary compact";
    viewButton.textContent = "查看";
    viewButton.addEventListener("click", () => {
      showQuestionnaireDetail(survey);
    });
    actions.append(viewButton);

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "secondary compact";
    copyButton.textContent = "复制";
    copyButton.addEventListener("click", () => {
      startCopy(survey);
    });
    actions.append(copyButton);

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "secondary compact";
    editButton.textContent = "编辑";
    if (survey.has_submissions) {
      editButton.disabled = true;
      editButton.title = "该问卷已有答卷，不能编辑。";
    } else {
      editButton.addEventListener("click", () => {
        startEdit(survey);
      });
    }
    actions.append(editButton);

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "secondary compact";
    deleteButton.textContent = "删除问卷";
    if (survey.has_submissions) {
      deleteButton.disabled = true;
      deleteButton.title = "该问卷已有答卷，不能删除。";
    } else {
      deleteButton.addEventListener("click", () => {
        deleteSurvey(survey, deleteButton);
      });
    }
    actions.append(deleteButton);

    row.append(title, id, created, actions);
    surveyList.append(row);
  }
}

async function deleteSurvey(survey, button) {
  const confirmed = window.confirm(
    `确定删除问卷《${survey.title}》吗？删除后无法恢复。`,
  );
  if (!confirmed) {
    return;
  }

  button.disabled = true;
  setStatus(listStatus, "正在删除问卷……");
  try {
    const response = await fetch(
      `/api/admin/questionnaires/${encodeURIComponent(survey.survey_id)}`,
      { method: "DELETE" },
    );
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
      const body = await response.json().catch(() => null);
      if (body?.code === "QUESTIONNAIRE_HAS_SUBMISSIONS") {
        throw new Error("该问卷已有答卷，不能删除。");
      }
      throw new Error(await responseError(response));
    }
    setStatus(listStatus, `问卷《${survey.title}》已删除。`, "success");
    await loadSurveys();
  } catch (error) {
    setStatus(listStatus, error.message, "error");
    button.disabled = false;
  }
}

async function showQuestionnaireDetail(survey) {
  detailPanel.hidden = false;
  detailSubtitle.textContent = `《${survey.title}》`;
  detailList.replaceChildren();
  setStatus(detailStatus, "正在加载问卷详情……");
  try {
    const response = await fetch(
      `/api/admin/questionnaires/${encodeURIComponent(survey.survey_id)}`,
    );
    if (response.status === 401) {
      setAuthenticated(false);
      setStatus(
        loginStatus,
        "登录状态不可用或已过期。本地开发请使用 HTTPS，然后重新登录。",
        "error",
      );
      return;
    }
    if (response.status === 404) {
      setStatus(detailStatus, "问卷不存在或不可读取。", "error");
      return;
    }
    if (!response.ok) {
      throw new Error(await responseError(response));
    }
    const result = await response.json();
    for (const [index, question] of result.survey.questions.entries()) {
      const item = document.createElement("li");
      const label = document.createElement("p");
      label.className = "questionnaire-detail-label";
      label.textContent = `${index + 1}. ${question.label}`;
      const meta = document.createElement("p");
      meta.className = "questionnaire-detail-meta";
      const typeName = QUESTION_TYPE_NAMES[question.type] ?? question.type;
      const requiredText = question.required ? "（必填）" : "";
      const optionsText = question.options.length > 0
        ? `　选项：${question.options.join("、")}`
        : "";
      meta.textContent = `${typeName}${requiredText}${optionsText}`;
      item.append(label, meta);
      detailList.append(item);
    }
    setStatus(detailStatus, "");
    detailPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    setStatus(detailStatus, error.message, "error");
  }
}

function startCopy(survey) {
  const url = new URL(window.location.href);
  url.searchParams.set("copy", survey.survey_id);
  window.history.replaceState(null, "", url);
  enterCopyMode(survey.survey_id).then(() => {
    editorForm.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function startEdit(survey) {
  const url = new URL(window.location.href);
  url.searchParams.set("edit", survey.survey_id);
  window.history.replaceState(null, "", url);
  enterEditMode(survey.survey_id).then(() => {
    editorForm.scrollIntoView({ behavior: "smooth", block: "start" });
  });
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

editorForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const validationError = validateEditor();
  if (validationError !== null) {
    setStatus(editorStatus, validationError, "error");
    return;
  }

  const mode = editorMode;
  saveButton.disabled = true;
  setStatus(
    editorStatus,
    mode === "edit"
      ? "正在保存修改……"
      : mode === "copy"
        ? "正在保存副本……"
        : "正在创建问卷……",
  );
  try {
    const response = mode === "edit"
      ? await fetch(
        `/api/admin/questionnaires/${encodeURIComponent(activeEditorSurveyId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editorPayload({ includeQuestionIds: true })),
        },
      )
      : await fetch("/api/admin/questionnaires", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editorPayload()),
      });
    if (!response.ok) {
      if (response.status === 409) {
        const body = await response.json().catch(() => null);
        if (body?.code === "QUESTIONNAIRE_HAS_SUBMISSIONS") {
          throw new Error("该问卷已有答卷，不能编辑。");
        }
      }
      throw new Error(await responseError(response));
    }
    resetToCreateMode();
    setStatus(
      editorStatus,
      mode === "edit"
        ? "问卷修改已保存。"
        : mode === "copy"
          ? "副本已保存为新的独立问卷。"
          : "问卷创建成功。",
      "success",
    );
    await loadSurveys();
  } catch (error) {
    setStatus(editorStatus, error.message, "error");
  } finally {
    saveButton.disabled = false;
  }
});

cancelButton.addEventListener("click", () => {
  resetToCreateMode();
  setStatus(editorStatus, "已取消，已返回新建问卷。");
});

document.querySelector("#close-detail-button").addEventListener("click", () => {
  detailPanel.hidden = true;
  detailList.replaceChildren();
});

document.querySelector("#refresh-button").addEventListener("click", () => loadSurveys());
loadMoreButton.addEventListener("click", () => loadSurveys({ append: true }));

addQuestion();

const pageParams = new URLSearchParams(window.location.search);
const requestedCopyId = pageParams.get("copy");
const requestedEditId = pageParams.get("edit");

try {
  const response = await fetch("/api/admin/session");
  const authenticated = response.ok;
  setAuthenticated(authenticated);
  if (authenticated) {
    await loadSurveys();
    if (requestedEditId !== null && requestedEditId !== "") {
      await enterEditMode(requestedEditId);
    } else if (requestedCopyId !== null && requestedCopyId !== "") {
      await enterCopyMode(requestedCopyId);
    }
  }
} catch {
  setAuthenticated(false);
  setStatus(loginStatus, "无法连接服务器。", "error");
}
