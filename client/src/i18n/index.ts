import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";

/** English strings for navigation and common actions. Hindi can be added as another resource file. */
void i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
