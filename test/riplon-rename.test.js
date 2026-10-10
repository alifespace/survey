import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pages = [
  "index.html",
  "survey.html",
  "admin.html",
  "admin-submissions.html",
];

test("every user-facing page shows the RIPLON survey name", async () => {
  for (const page of pages) {
    const html = await readFile(new URL(`../public/${page}`, import.meta.url), "utf8");
    assert.ok(html.includes("RIPLON 调查"), `${page} must show the RIPLON name`);
    assert.equal(html.includes("Cloudflare 调查"), false, `${page} must not show the old name`);
  }
});

test("no stale user-facing brand strings remain in public scripts", async () => {
  for (const script of ["admin.js", "customer.js", "admin-submissions.js", "survey-selection.js"]) {
    const js = await readFile(new URL(`../public/${script}`, import.meta.url), "utf8");
    assert.equal(js.includes("Cloudflare 调查"), false, `${script} must not show the old name`);
    assert.equal(js.includes("Cloudflare Survey"), false, `${script} must not show the old name`);
  }
});
