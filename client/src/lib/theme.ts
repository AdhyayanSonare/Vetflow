import { useSyncExternalStore } from "react";

/** Light, dark, or follow the device. The choice is kept in this browser only. */
export type ThemeChoice = "light" | "dark" | "system";
const KEY = "vetflow-theme";
const listeners = new Set<() => void>();

const read = (): ThemeChoice => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    return "system";
  }
};
const prefersDark = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;

export const resolveTheme = (choice: ThemeChoice): "light" | "dark" => (choice === "system" ? (prefersDark() ? "dark" : "light") : choice);

export function applyTheme(choice: ThemeChoice = read()) {
  document.documentElement.classList.toggle("dark", resolveTheme(choice) === "dark");
}

export function setTheme(choice: ThemeChoice) {
  try { localStorage.setItem(KEY, choice); } catch { /* private mode: the choice lasts for this page only */ }
  applyTheme(choice);
  listeners.forEach(fn => fn());
}

/** Call once at start-up. Keeps the page in step with the device when the choice is "system". */
export function initTheme() {
  applyTheme();
  if (typeof matchMedia !== "undefined") matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (read() === "system") applyTheme("system"); });
}

export function useTheme() {
  const choice = useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, read, () => "system" as ThemeChoice);
  return { choice, resolved: resolveTheme(choice), setTheme };
}
