import {
  isValidEmail,
  loadAvailableQuestionnaires,
} from "./questionnaire-api.js";

const ENTRY_STORAGE_KEY = "survey_entry_v1";
const entryForm = document.querySelector("#entry-form");
const emailInput = document.querySelector("#email");
const emailError = document.querySelector("#email-error");
const surveyFieldset = document.querySelector("#survey-fieldset");
const surveyList = document.querySelector("#survey-list");
const listStatus = document.querySelector("#list-status");
const retryButton = document.querySelector("#retry-button");
const continueButton = document.querySelector("#continue-button");

let availableSurveys = new Map();

function selectedSurveyId() {
  return entryForm.querySelector('input[name="survey_id"]:checked')?.value ?? null;
}

function updateContinueButton() {
  continueButton.disabled = !isValidEmail(emailInput.value) || selectedSurveyId() === null;
}

function renderSurveys(surveys) {
  surveyList.replaceChildren();
  availableSurveys = new Map(surveys.map((survey) => [survey.survey_id, survey]));

  for (const survey of surveys) {
    const label = document.createElement("label");
    const radio = document.createElement("input");
    const title = document.createElement("span");
    label.className = "survey-option";
    radio.type = "radio";
    radio.name = "survey_id";
    radio.value = survey.survey_id;
    title.className = "survey-title";
    title.textContent = survey.title;
    label.append(radio, title);
    surveyList.append(label);
  }
}

async function refreshSurveys() {
  surveyFieldset.hidden = true;
  retryButton.hidden = true;
  continueButton.disabled = true;
  listStatus.className = "status";
  listStatus.textContent = "正在加载问卷……";

  try {
    const surveys = await loadAvailableQuestionnaires();
    renderSurveys(surveys);
    if (surveys.length === 0) {
      listStatus.textContent = "当前没有可填写的问卷。";
      return;
    }

    surveyFieldset.hidden = false;
    listStatus.textContent = `共有 ${surveys.length} 份可用问卷。`;
    updateContinueButton();
  } catch {
    availableSurveys = new Map();
    surveyList.replaceChildren();
    listStatus.className = "status error";
    listStatus.textContent = "暂时无法加载问卷，请稍后重试。";
    retryButton.hidden = false;
  }
}

emailInput.addEventListener("input", () => {
  emailError.textContent = "";
  updateContinueButton();
});

emailInput.addEventListener("blur", () => {
  emailInput.value = emailInput.value.trim();
  if (emailInput.value !== "" && !isValidEmail(emailInput.value)) {
    emailError.textContent = "请输入有效的 Email。";
  }
  updateContinueButton();
});

surveyList.addEventListener("change", updateContinueButton);
retryButton.addEventListener("click", refreshSurveys);

entryForm.addEventListener("submit", (event) => {
  event.preventDefault();
  emailInput.value = emailInput.value.trim();
  if (!isValidEmail(emailInput.value)) {
    emailError.textContent = emailInput.value === ""
      ? "请输入 Email。"
      : "请输入有效的 Email。";
    emailInput.focus();
    updateContinueButton();
    return;
  }

  const surveyId = selectedSurveyId();
  const survey = surveyId === null ? undefined : availableSurveys.get(surveyId);
  if (survey === undefined) {
    listStatus.className = "status error";
    listStatus.textContent = "请选择一份当前可用的问卷。";
    updateContinueButton();
    return;
  }

  sessionStorage.setItem(ENTRY_STORAGE_KEY, JSON.stringify({
    email: emailInput.value,
    survey_id: survey.survey_id,
    title: survey.title,
  }));
  window.location.assign(`/survey.html?${new URLSearchParams({ survey_id: survey.survey_id })}`);
});

await refreshSurveys();
