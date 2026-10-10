import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const html = await readFile(
  new URL("../public/admin.html", import.meta.url),
  "utf8",
);
const js = await readFile(
  new URL("../public/admin.js", import.meta.url),
  "utf8",
);

test("the editor form never asks for or submits question IDs", () => {
  assert.equal(html.includes("question-id"), false);
  assert.equal(js.includes(".question-id"), false);
  assert.equal(js.includes("question_id:"), false);
});

test("create and copy share one editor form with a clear mode banner and cancel", () => {
  for (const marker of [
    'id="editor-form"',
    'id="editor-status"',
    'id="editor-heading"',
    'id="editor-mode-banner"',
    'id="cancel-editor-button"',
    'id="save-button"',
    'id="survey-title"',
  ]) {
    assert.ok(html.includes(marker), `missing ${marker}`);
  }

  assert.match(html, /id="cancel-editor-button"[^>]*hidden/u);
  assert.match(html, /id="editor-mode-banner"[^>]*hidden/u);
  assert.ok(js.includes('"复制问卷"'));
  assert.ok(js.includes('"保存副本"'));
  assert.ok(js.includes("取消复制"));
});

test("copy mode prefills from the admin questionnaire detail API", () => {
  assert.match(js, /URLSearchParams\(window\.location\.search\)\.get\("copy"\)/u);
  assert.ok(js.includes("/api/admin/questionnaires/"));
  assert.ok(js.includes("applyCopyMode"));
  assert.ok(js.includes("resetToCreateMode"));
});

test("the question editor keeps add, remove, reorder, type, label, required, and options controls", () => {
  for (const marker of [
    "move-up",
    "move-down",
    "add-after",
    "remove",
    "question-type",
    "question-label",
    "question-required",
    "question-options",
  ]) {
    assert.ok(html.includes(marker), `missing ${marker}`);
  }
});

test("adding a question happens from the question card, not the panel heading", () => {
  assert.equal(html.includes('id="add-question-button"'), false);
  assert.equal(js.includes("#add-question-button"), false);
  assert.ok(js.includes('querySelector(".add-after")'));
  assert.match(js, /addQuestion\(null, card\)/u);
});

test("client validation runs before submit and the server stays authoritative", () => {
  assert.ok(js.includes("validateEditor"));
  assert.match(js, /editorForm\.addEventListener\("submit"/u);
});

test("list rows enable delete only without submissions and enable view only with submissions", () => {
  assert.ok(js.includes("has_submissions"));
  assert.ok(js.includes("删除问卷"));
  assert.ok(js.includes("查看答卷"));
  assert.ok(js.includes("QUESTIONNAIRE_HAS_SUBMISSIONS"));
  assert.ok(js.includes("window.confirm"));
  assert.match(js, /method: "DELETE"/u);
});
