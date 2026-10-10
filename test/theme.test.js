import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  THEME_STORAGE_KEY,
  createThemeController,
  nextThemePreference,
  normalizeThemePreference,
  resolveTheme,
} from "../public/theme.js";

function fakeRoot() {
  return { dataset: {}, style: {} };
}

function fakeToggle() {
  const listeners = new Map();
  return {
    dataset: {},
    attributes: new Map(),
    setAttribute(name, value) {
      this.attributes.set(name, value);
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) {
        listeners.delete(type);
      }
    },
    click() {
      listeners.get("click")?.();
    },
  };
}

function fakeMediaQuery(matches = false) {
  const listeners = new Set();
  return {
    matches,
    addEventListener(type, listener) {
      if (type === "change") {
        listeners.add(listener);
      }
    },
    removeEventListener(type, listener) {
      if (type === "change") {
        listeners.delete(listener);
      }
    },
    change(nextMatches) {
      this.matches = nextMatches;
      for (const listener of listeners) {
        listener({ matches: nextMatches });
      }
    },
  };
}

test("normalizes theme preferences and resolves the system theme", () => {
  assert.equal(normalizeThemePreference("dark"), "dark");
  assert.equal(normalizeThemePreference("invalid"), "system");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("light", true), "light");
});

test("cycles preferences in light, system, dark order", () => {
  assert.equal(nextThemePreference("light"), "system");
  assert.equal(nextThemePreference("system"), "dark");
  assert.equal(nextThemePreference("dark"), "light");
  assert.equal(nextThemePreference("invalid"), "dark");
});

test("restores a saved preference and persists toggle clicks", () => {
  const values = new Map([[THEME_STORAGE_KEY, "dark"]]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const root = fakeRoot();
  const toggle = fakeToggle();
  const controller = createThemeController({
    root,
    storage,
    mediaQuery: fakeMediaQuery(false),
    toggles: [toggle],
  });

  assert.equal(root.dataset.theme, "dark");
  assert.equal(toggle.dataset.themePreference, "dark");
  assert.match(toggle.attributes.get("aria-label"), /深色主题/u);

  toggle.click();
  assert.equal(controller.preference, "light");
  assert.equal(root.dataset.theme, "light");
  assert.equal(values.get(THEME_STORAGE_KEY), "light");
  assert.equal(toggle.dataset.themePreference, "light");
  assert.match(toggle.attributes.get("aria-label"), /浅色主题/u);

  toggle.click();
  assert.equal(controller.preference, "system");
  assert.match(toggle.attributes.get("aria-label"), /跟随系统主题/u);

  controller.destroy();
});

test("updates with system changes only while following the system", () => {
  const root = fakeRoot();
  const mediaQuery = fakeMediaQuery(false);
  const controller = createThemeController({
    root,
    storage: null,
    mediaQuery,
  });

  assert.equal(root.dataset.theme, "light");
  mediaQuery.change(true);
  assert.equal(root.dataset.theme, "dark");
  controller.setPreference("light");
  mediaQuery.change(false);
  mediaQuery.change(true);
  assert.equal(root.dataset.theme, "light");
  controller.destroy();
});

test("falls back to system when storage is unavailable or invalid", () => {
  const root = fakeRoot();
  const storage = {
    getItem() {
      throw new Error("unavailable");
    },
    setItem() {
      throw new Error("unavailable");
    },
  };
  const controller = createThemeController({
    root,
    storage,
    mediaQuery: fakeMediaQuery(true),
  });

  assert.equal(controller.preference, "system");
  assert.equal(root.dataset.themePreference, "system");
  assert.equal(root.dataset.theme, "dark");
  assert.doesNotThrow(() => controller.setPreference("invalid"));
  assert.equal(controller.preference, "system");
  controller.destroy();
});

test("loads theme initialization, styles, controls, and behavior on every page", async () => {
  const pages = [
    "index.html",
    "survey.html",
    "admin.html",
    "admin-submissions.html",
  ];

  for (const page of pages) {
    const html = await readFile(new URL(`../public/${page}`, import.meta.url), "utf8");
    const initIndex = html.indexOf("/theme-init.js");
    const styleIndex = html.indexOf("/theme.css");
    assert.notEqual(initIndex, -1, `${page} must preload the theme`);
    assert.notEqual(styleIndex, -1, `${page} must load theme styles`);
    assert.ok(initIndex < styleIndex, `${page} must apply the theme before styles`);
    assert.match(html, /src="\/theme\.js"/u);
    assert.match(html, /data-theme-toggle/u);
    assert.match(html, /class="theme-icon"/u);
    assert.equal(html.includes("data-theme-select"), false);
    assert.equal(html.includes("theme-picker"), false);
  }
});
