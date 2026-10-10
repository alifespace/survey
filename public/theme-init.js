(function applyInitialTheme() {
  const storageKey = "survey_theme_v1";
  const validPreferences = new Set(["system", "light", "dark"]);
  let preference = "system";

  try {
    const storedPreference = window.localStorage.getItem(storageKey);
    if (validPreferences.has(storedPreference)) {
      preference = storedPreference;
    }
  } catch {
    preference = "system";
  }

  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches === true;
  const theme = preference === "system"
    ? (prefersDark ? "dark" : "light")
    : preference;
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}());
