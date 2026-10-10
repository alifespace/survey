import {
  isValidEmail,
  loadQuestionnaire,
  submitQuestionnaire,
} from "./questionnaire-api.js";

const ENTRY_STORAGE_KEY = "survey_entry_v1";
const heading = document.querySelector("#survey-heading");
const status = document.querySelector("#selection-status");
const surveyForm = document.querySelector("#survey-form");
const questionList = document.querySelector("#question-list");
const submitButton = document.querySelector("#submit-button");
const submitStatus = document.querySelector("#submit-status");
const successView = document.querySelector("#success-view");

let questionnaire = null;
let submitting = false;
const questionControls = new Map();

function readEntry() {
  const surveyId = new URLSearchParams(window.location.search).get("survey_id");
  const stored = sessionStorage.getItem(ENTRY_STORAGE_KEY);
  if (surveyId === null || stored === null) {
    return null;
  }

  try {
    const entry = JSON.parse(stored);
    if (
      entry === null ||
      typeof entry !== "object" ||
      typeof entry.email !== "string" ||
      !isValidEmail(entry.email) ||
      typeof entry.survey_id !== "string" ||
      entry.survey_id !== surveyId
    ) {
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function showUnavailable(message) {
  heading.textContent = "无法打开问卷";
  status.className = "status error";
  status.textContent = message;
  surveyForm.hidden = true;
}

function requiredLabel(question) {
  const fragment = document.createDocumentFragment();
  const text = document.createElement("span");
  text.textContent = question.label;
  fragment.append(text);
  if (question.required) {
    const required = document.createElement("span");
    required.className = "required-mark";
    required.textContent = "必填";
    fragment.append(required);
  }
  return fragment;
}

function textControl(question, index) {
  const label = document.createElement("label");
  const control = question.type === "textarea"
    ? document.createElement("textarea")
    : document.createElement("input");
  control.id = `question-${index}`;
  control.name = question.question_id;
  control.required = question.required;
  if (question.type === "textarea") {
    control.rows = 5;
  } else {
    control.type = question.type;
  }
  if (question.type === "text" || question.type === "textarea") {
    control.maxLength = 4000;
  }
  if (question.type === "email") {
    control.maxLength = 254;
    control.autocomplete = "email";
  }
  label.htmlFor = control.id;
  label.append(requiredLabel(question));
  questionControls.set(question.question_id, control);
  return { label, control };
}

function choiceControl(question, index) {
  const fieldset = document.createElement("fieldset");
  const legend = document.createElement("legend");
  const controls = [];
  fieldset.className = "choice-group";
  legend.append(requiredLabel(question));
  fieldset.append(legend);

  question.options.forEach((option, optionIndex) => {
    const label = document.createElement("label");
    const control = document.createElement("input");
    const text = document.createElement("span");
    control.type = question.type === "single_choice" ? "radio" : "checkbox";
    control.name = question.question_id;
    control.value = option;
    control.id = `question-${index}-option-${optionIndex}`;
    if (question.type === "single_choice") {
      control.required = question.required;
    }
    text.textContent = option;
    label.className = "choice-option";
    label.htmlFor = control.id;
    label.append(control, text);
    fieldset.append(label);
    controls.push(control);
  });
  questionControls.set(question.question_id, controls);
  return fieldset;
}

function renderQuestionnaire(survey) {
  questionList.replaceChildren();
  questionControls.clear();
  survey.questions.forEach((question, index) => {
    const container = document.createElement("section");
    container.className = "response-question";
    if (question.type === "single_choice" || question.type === "multi_choice") {
      container.append(choiceControl(question, index));
    } else {
      const { label, control } = textControl(question, index);
      container.append(label, control);
    }
    questionList.append(container);
  });
}

function collectAnswers() {
  return Object.fromEntries(questionnaire.questions.map((question) => {
    const controls = questionControls.get(question.question_id);
    if (question.type === "multi_choice") {
      return [question.question_id, controls.filter(({ checked }) => checked).map(({ value }) => value)];
    }
    if (question.type === "single_choice") {
      return [question.question_id, controls.find(({ checked }) => checked)?.value ?? ""];
    }
    return [question.question_id, controls.value];
  }));
}

function validateCustomAnswers() {
  for (const question of questionnaire.questions) {
    const controls = questionControls.get(question.question_id);
    if (question.type === "multi_choice") {
      const first = controls[0];
      first.setCustomValidity(
        question.required && !controls.some(({ checked }) => checked)
          ? "请至少选择一项。"
          : "",
      );
    } else if (
      question.required &&
      question.type !== "single_choice" &&
      controls.value.trim() === ""
    ) {
      controls.setCustomValidity("请填写此题。");
    } else if (!Array.isArray(controls)) {
      controls.setCustomValidity("");
    }
  }
  return surveyForm.reportValidity();
}

surveyForm.addEventListener("input", () => {
  for (const controls of questionControls.values()) {
    if (Array.isArray(controls)) {
      controls[0]?.setCustomValidity("");
    } else {
      controls.setCustomValidity("");
    }
  }
});

surveyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submitting || questionnaire === null || !validateCustomAnswers()) {
    return;
  }

  submitting = true;
  submitButton.disabled = true;
  submitStatus.className = "status";
  submitStatus.textContent = "正在提交答卷……";
  try {
    const submission = await submitQuestionnaire(questionnaire.survey_id, {
      email: entry.email,
      answers: collectAnswers(),
    });
    sessionStorage.removeItem(ENTRY_STORAGE_KEY);
    surveyForm.hidden = true;
    successView.hidden = false;
    status.textContent = "";
    document.querySelector("#submission-id").textContent = submission.submission_id;
  } catch (error) {
    submitStatus.className = "status error";
    submitStatus.textContent = error.message === "QUESTIONNAIRE_UNAVAILABLE"
      ? "问卷当前不可用，无法提交。"
      : "答卷提交失败，请检查填写内容后重试。";
    submitting = false;
    submitButton.disabled = false;
  }
});

const entry = readEntry();
if (entry === null) {
  showUnavailable("请先输入有效的 Email 并选择问卷。");
} else {
  try {
    questionnaire = await loadQuestionnaire(entry.survey_id);
    heading.textContent = questionnaire.title;
    status.className = "status";
    status.textContent = "请填写以下题目。";
    document.querySelector("#selected-email").textContent = entry.email;
    renderQuestionnaire(questionnaire);
    surveyForm.hidden = false;
  } catch {
    showUnavailable("问卷不存在、当前不可用或暂时无法加载，请返回重新选择。");
  }
}
