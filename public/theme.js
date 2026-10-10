export const THEME_STORAGE_KEY = "survey_theme_v1";
export const THEME_PREFERENCES = Object.freeze(["system", "light", "dark"]);
export const THEME_CYCLE_ORDER = Object.freeze(["light", "system", "dark"]);
export const THEME_TOGGLE_LABELS = Object.freeze({
  light: "浅色主题",
  system: "跟随系统主题",
  dark: "深色主题",
});

export function normalizeThemePreference(value) {
  return THEME_PREFERENCES.includes(value) ? value : "system";
}

export function nextThemePreference(value) {
  const current = normalizeThemePreference(value);
  const index = THEME_CYCLE_ORDER.indexOf(current);
  return THEME_CYCLE_ORDER[(index + 1) % THEME_CYCLE_ORDER.length];
}

export function resolveTheme(preference, prefersDark) {
  const normalizedPreference = normalizeThemePreference(preference);
  return normalizedPreference === "system"
    ? (prefersDark ? "dark" : "light")
    : normalizedPreference;
}

function readPreference(storage) {
  try {
    return normalizeThemePreference(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

function savePreference(storage, preference) {
  try {
    storage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Theme selection still works for the current page when storage is unavailable.
  }
}

export function createThemeController({ root, storage, mediaQuery, toggles = [] }) {
  let preference = readPreference(storage);

  function applyTheme() {
    const theme = resolveTheme(preference, mediaQuery?.matches === true);
    root.dataset.themePreference = preference;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    for (const toggle of toggles) {
      toggle.dataset.themePreference = preference;
      const label = `主题：${THEME_TOGGLE_LABELS[preference]}，点击切换`;
      toggle.setAttribute("aria-label", label);
      toggle.title = label;
    }
    return theme;
  }

  function setPreference(value) {
    preference = normalizeThemePreference(value);
    savePreference(storage, preference);
    return applyTheme();
  }

  const onToggleClick = () => setPreference(nextThemePreference(preference));
  const onSystemThemeChange = () => {
    if (preference === "system") {
      applyTheme();
    }
  };

  for (const toggle of toggles) {
    toggle.addEventListener("click", onToggleClick);
  }
  mediaQuery?.addEventListener?.("change", onSystemThemeChange);
  applyTheme();

  return {
    get preference() {
      return preference;
    },
    setPreference,
    destroy() {
      for (const toggle of toggles) {
        toggle.removeEventListener("click", onToggleClick);
      }
      mediaQuery?.removeEventListener?.("change", onSystemThemeChange);
    },
  };
}

export function initializeTheme(documentObject = document, windowObject = window) {
  let storage = null;
  try {
    storage = windowObject.localStorage;
  } catch {
    storage = null;
  }
  return createThemeController({
    root: documentObject.documentElement,
    storage,
    mediaQuery: windowObject.matchMedia?.("(prefers-color-scheme: dark)"),
    toggles: [...documentObject.querySelectorAll("[data-theme-toggle]")],
  });
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  initializeTheme();
}
