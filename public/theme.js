export const THEME_STORAGE_KEY = "survey_theme_v1";
export const THEME_PREFERENCES = Object.freeze(["system", "light", "dark"]);

export function normalizeThemePreference(value) {
  return THEME_PREFERENCES.includes(value) ? value : "system";
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

export function createThemeController({ root, storage, mediaQuery, controls = [] }) {
  let preference = readPreference(storage);

  function applyTheme() {
    const theme = resolveTheme(preference, mediaQuery?.matches === true);
    root.dataset.themePreference = preference;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    for (const control of controls) {
      control.value = preference;
    }
    return theme;
  }

  function setPreference(value) {
    preference = normalizeThemePreference(value);
    savePreference(storage, preference);
    return applyTheme();
  }

  const onControlChange = (event) => setPreference(event.currentTarget.value);
  const onSystemThemeChange = () => {
    if (preference === "system") {
      applyTheme();
    }
  };

  for (const control of controls) {
    control.addEventListener("change", onControlChange);
  }
  mediaQuery?.addEventListener?.("change", onSystemThemeChange);
  applyTheme();

  return {
    get preference() {
      return preference;
    },
    setPreference,
    destroy() {
      for (const control of controls) {
        control.removeEventListener("change", onControlChange);
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
    controls: [...documentObject.querySelectorAll("[data-theme-select]")],
  });
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  initializeTheme();
}
