import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("home page provides an accessible split layout without changing form hooks", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

  assert.match(html, /<body class="home-page">/u);
  assert.match(html, /<main class="home-shell">/u);
  assert.match(html, /<section class="home-primary" aria-labelledby="home-heading">/u);
  assert.match(html, /<aside class="home-aside" aria-labelledby="home-aside-heading">/u);
  assert.match(html, /id="entry-form"/u);
  assert.match(html, /id="email"/u);
  assert.match(html, /id="survey-select"/u);
  assert.match(html, /id="continue-button"/u);
  assert.doesNotMatch(html, /supabase/iu);
});

test("split layout styles live in the shared theme stylesheet", async () => {
  const css = await readFile(new URL("../public/theme.css", import.meta.url), "utf8");

  assert.ok(css.includes(".home-shell {\n  display: grid;"));
  assert.ok(css.includes("grid-template-columns: minmax("));
  const narrowStyles = css.slice(css.indexOf("@media (max-width: 900px)"));
  assert.ok(narrowStyles.includes(".home-shell {\n    display: block;"));
  assert.ok(narrowStyles.includes(".home-aside {\n    display: none;"));
});

test("admin login uses the split layout and links back to the home page", async () => {
  const html = await readFile(new URL("../public/admin.html", import.meta.url), "utf8");

  assert.match(html, /id="login-view" class="home-shell"/u);
  assert.match(html, /class="home-primary"/u);
  assert.match(html, /class="home-aside"/u);
  assert.match(html, /class="back-link" href="\/"/u);
  assert.match(html, /返回主页/u);
});

test("the home page offers surveys through a dropdown with the first entry selected", async () => {
  const customer = await readFile(new URL("../public/customer.js", import.meta.url), "utf8");

  assert.ok(customer.includes("#survey-select"));
  assert.equal(customer.includes('type = "radio"'), false);
  assert.match(customer, /option\.value = survey\.survey_id/u);
});
