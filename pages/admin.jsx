import { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import axios from "axios";
import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";
import StartScreen from "@/components/StartScreen";
import RatingPanel from "@/components/RatingPanel";
import StimulusPreview from "@/components/StimulusPreview";
import AdminLanguageSwitcher from "@/components/AdminLanguageSwitcher";
import ConfirmStimulusDeletion from "@/components/ConfirmStimulusDeletion";
import ConfirmResultsDeletion from "@/components/ConfirmResultsDeletion";
import StimulusDropZone from "@/components/StimulusDropZone";
import { adminMessage, translateAdmin } from "@/utils/admin-i18n.cjs";
import { phases, phaseIntroKeys } from "@/utils/study-phases.cjs";
import {
  questionRows,
  questionsToCsv,
  removeStimulusQuestions,
} from "@/utils/questions.cjs";
import { stimulusInfo } from "@/utils/stimuli.cjs";
import { adaptStudyTexts } from "@/utils/study-texts.cjs";
import pl from "@/public/locales/pl/common.json";
import en from "@/public/locales/en/common.json";

const tabs = [
  ["videos", "Bodźce"],
  ["flow", "Przebieg i skale"],
  ["texts", "Teksty ekranów"],
  ["questions", "Pytania kontrolne"],
  ["preview", "Podgląd"],
  ["results", "Wyniki"],
  ["access", "Dostęp"],
];
const textFields = [
  ["welcome", "Tytuł powitania"],
  ["instruction", "Instrukcja"],
  ["instruction_loadings", "Informacja o ładowaniu"],
  ["instruction_scoring", "Wskazówka do oceny"],
  ["two_parts_instruction", "Opis dwóch części"],
  ["thanks", "Tytuł podziękowania"],
  ["end_info", "Podziękowanie"],
  ["part_two", "Tytuł drugiej części — suwak"],
  ["slider_instruction", "Instrukcja drugiej części — suwak"],
  ["standard_part_two", "Tytuł drugiej części — przyciski"],
  ["standard_instruction", "Instrukcja drugiej części — przyciski"],
  ["rate_quality", "Pytanie o ocenę"],
];
const modes = {
  both: "Obie skale — dwie części",
  standard: "Tylko skala z przyciskami (1–5)",
  slider: "Tylko skala z suwakiem (1–5)",
};
const questionParts = {
  first: "Pierwsza część",
  second: "Druga część",
  both: "Obie części",
};
const phaseOrders = {
  "standard-first": "Najpierw przyciski, potem suwak",
  "slider-first": "Najpierw suwak, potem przyciski",
  balanced: "Na zmianę między uczestnikami (50/50)",
};
const hexColor = /^#[0-9a-f]{6}$/i;
function colorText(background) {
  const channels = background
    .slice(1)
    .match(/.{2}/g)
    .map((channel) => parseInt(channel, 16) / 255);
  const luminance = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * luminance[0] + 0.7152 * luminance[1] + 0.0722 * luminance[2] >
    0.179
    ? "#111827"
    : "#ffffff";
}
function Field({ label, children, hint, muted = false }) {
  return (
    <label className={`admin-field${muted ? " admin-field-muted" : ""}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function download(filename, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function Admin() {
  const [adminLocale, setAdminLocale] = useState("pl");
  const t = (text, values) => translateAdmin(adminLocale, text, values);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("admin-panel-language");
      if (saved === "pl" || saved === "en") setAdminLocale(saved);
    } catch {
      /* The panel also works when browser storage is unavailable. */
    }
  }, []);
  const changeAdminLocale = (language) => {
    setAdminLocale(language);
    try {
      window.localStorage.setItem("admin-panel-language", language);
    } catch {
      /* Keep the selected language for this visit. */
    }
  };

  const [settings, setSettings] = useState(null);
  const [backgroundColorDraft, setBackgroundColorDraft] = useState("");
  const backgroundColorInvalid = !hexColor.test(backgroundColorDraft);
  const [catalog, setCatalog] = useState([]);
  const [selectionsByType, setSelectionsByType] = useState({});
  const activeCatalog = catalog.filter(
    (file) => file.type === (settings?.stimulusType || "video"),
  );
  const imageStudy = settings?.stimulusType === "image";
  const [questions, setQuestions] = useState([]);
  const activeStimulusNames = new Set(activeCatalog.map((file) => file.name));
  const activeQuestionCount = questions.filter((question) =>
    activeStimulusNames.has(question.video_name),
  ).length;
  const [rawCsv, setRawCsv] = useState(null);
  const [version, setVersion] = useState(null);
  const [tab, setTab] = useState("videos");
  const [locale, setLocale] = useState("pl");
  const [previewScreen, setPreviewScreen] = useState("start");
  const [previewRating, setPreviewRating] = useState(null);
  const [previewFirstPhase, setPreviewFirstPhase] = useState("standard");
  const previewSequence = settings
    ? phases({
        ...settings,
        phaseSequence:
          settings.mode === "both" && settings.phaseOrder === "balanced"
            ? [
                previewFirstPhase,
                previewFirstPhase === "standard" ? "slider" : "standard",
              ]
            : undefined,
      })
    : [];
  const previewIntroKeys = phaseIntroKeys(previewSequence[1]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [access, setAccess] = useState(null);
  const [password, setPassword] = useState("");
  const [passwordProtected, setPasswordProtected] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [passkeys, setPasskeys] = useState([]);
  const [passkeyName, setPasskeyName] = useState("");
  const [passkeyAddress, setPasskeyAddress] = useState("");
  const [passkeyError, setPasskeyError] = useState("");
  const [removingKey, setRemovingKey] = useState(null);
  const [selectedPreview, setSelectedPreview] = useState("");
  const [pendingDeletion, setPendingDeletion] = useState(null);
  const [deletionError, setDeletionError] = useState("");
  const [stats, setStats] = useState(null);
  const [resultsDeletionStep, setResultsDeletionStep] = useState(0);
  const [resultsDeletionError, setResultsDeletionError] = useState("");
  const [completeOnly, setCompleteOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    try {
      const { data } = await axios.get("/api/admin/config");
      setSettings({
        ...data.settings,
        selectedVideos:
          data.settings.selectedVideos ||
          data.catalog
            .filter((file) => file.type === data.settings.stimulusType)
            .map((file) => file.name),
      });
      setBackgroundColorDraft(data.settings.backgroundColor);
      setSelectionsByType({});
      setCatalog(data.catalog);
      setVersion(data.version);
      setPasswordProtected(data.passwordProtected);
      try {
        setQuestions(
          questionRows(
            data.questionsCsv,
            data.catalog.map((file) => file.name),
          ),
        );
        setRawCsv(null);
      } catch (e) {
        setRawCsv(data.questionsCsv);
        setError(e.message);
      }
      if (data.warning) setError(data.warning);
      setAccess(null);
      setDirty(false);
    } catch (e) {
      if (e.response?.status === 401) setAccess(e.response.data);
      else setError(e.response?.data?.error || "Nie udało się wczytać panelu.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    setPasskeySupported(
      window.isSecureContext &&
        typeof window.PublicKeyCredential !== "undefined",
    );
    load();
  }, []);
  useEffect(() => {
    if (!settings) return;
    if (
      (settings.mode === "slider" && previewScreen === "standard") ||
      (settings.mode === "standard" && previewScreen === "slider") ||
      (settings.mode !== "both" && previewScreen === "intro")
    ) {
      setPreviewScreen("start");
      setPreviewRating(null);
    }
  }, [settings, previewScreen]);
  useEffect(() => {
    const warn = (event) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const change = (patch) => {
    setSettings((previous) => ({ ...previous, ...patch }));
    setDirty(true);
    setMessage("");
  };
  const changeBackgroundColor = (value) => {
    setBackgroundColorDraft(value);
    setDirty(true);
    setMessage("");
    setError("");
    if (hexColor.test(value))
      setSettings((previous) => ({ ...previous, backgroundColor: value }));
  };
  const changeStimulusType = (type) => {
    setSelectionsByType((previous) => ({
      ...previous,
      [settings.stimulusType]: settings.selectedVideos,
    }));
    setSelectedPreview("");
    change({
      stimulusType: type,
      selectedVideos:
        selectionsByType[type] ??
        catalog.filter((file) => file.type === type).map((file) => file.name),
      texts: adaptStudyTexts(settings.texts, type),
    });
  };
  const changeQuestions = (rows) => {
    setQuestions(rows);
    setDirty(true);
    setMessage("");
  };
  const fail = (e) => {
    setError(
      e.response?.data?.error || e.message || "Operacja nie powiodła się.",
    );
    if (e.response?.status === 401) setAccess(e.response.data);
  };
  const save = async () => {
    if (backgroundColorInvalid) {
      setTab("flow");
      setError("Wpisz kolor tła w formacie #RRGGBB.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { data } = await axios.put("/api/admin/config", {
        settings,
        questionsCsv: rawCsv ?? questionsToCsv(questions, settings),
      });
      setSettings(data.settings);
      setBackgroundColorDraft(data.settings.backgroundColor);
      setVersion(data.version);
      setDirty(false);
      setQuestions(
        questionRows(
          data.questionsCsv,
          data.catalog.map((file) => file.name),
        ),
      );
      setRawCsv(null);
      setMessage(
        "Ustawienia zapisane. Będą używane przez osoby rozpoczynające badanie.",
      );
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const login = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await axios.post("/api/admin/auth", { password });
      setPassword("");
      await load();
    } catch (e) {
      setError(
        e.response?.data?.error || "Nie udało się zalogować. Spróbuj ponownie.",
      );
    } finally {
      setBusy(false);
    }
  };
  const browserError = (e) => {
    if (["NotAllowedError", "AbortError"].includes(e.name))
      return "Anulowano użycie klucza dostępu lub upłynął czas na potwierdzenie. Spróbuj ponownie.";
    if (
      ["InvalidStateError", "SecurityError", "NotSupportedError"].includes(
        e.name,
      )
    )
      return "Nie można użyć klucza dostępu w tej przeglądarce lub pod tym adresem. Otwórz panel w Chrome lub Safari pod adresem zaczynającym się od https:// albo na tym komputerze przez localhost.";
    return (
      e.response?.data?.error ||
      "Nie udało się użyć klucza dostępu. Spróbuj ponownie lub zaloguj się hasłem."
    );
  };
  const loginWithPasskey = async () => {
    setBusy(true);
    setError("");
    try {
      const { data: optionsJSON } = await axios.post("/api/admin/passkeys", {
        action: "authenticate-options",
      });
      const response = await startAuthentication({ optionsJSON });
      await axios.post("/api/admin/passkeys", {
        action: "authenticate-verify",
        response,
      });
      await load();
    } catch (e) {
      setError(browserError(e));
    } finally {
      setBusy(false);
    }
  };
  const loadPasskeys = async () => {
    setPasskeyError("");
    try {
      const { data } = await axios.get("/api/admin/passkeys");
      setPasskeys(data.keys);
      setPasskeyAddress(data.origin);
    } catch (e) {
      setPasskeyError(
        e.response?.data?.error || "Nie udało się wczytać kluczy dostępu.",
      );
      if (e.response?.status === 401) setAccess(e.response.data);
    }
  };
  const addPasskey = async () => {
    setBusy(true);
    setPasskeyError("");
    setMessage("");
    try {
      const { data: optionsJSON } = await axios.post("/api/admin/passkeys", {
        action: "register-options",
        name: passkeyName,
      });
      const response = await startRegistration({ optionsJSON });
      await axios.post("/api/admin/passkeys", {
        action: "register-verify",
        response,
      });
      setPasskeyName("");
      await loadPasskeys();
      setMessage("Klucz dostępu dodany. Możesz nim logować się do panelu.");
    } catch (e) {
      setPasskeyError(browserError(e));
    } finally {
      setBusy(false);
    }
  };
  const removePasskey = async (id) => {
    setBusy(true);
    setPasskeyError("");
    try {
      await axios.delete("/api/admin/passkeys", { data: { id } });
      setRemovingKey(null);
      await loadPasskeys();
      setMessage(
        "Klucz dostępu usunięty z panelu. Nie będzie już działać podczas logowania.",
      );
    } catch (e) {
      setPasskeyError(
        e.response?.data?.error || "Nie udało się usunąć klucza dostępu.",
      );
    } finally {
      setBusy(false);
    }
  };
  const importStimuli = async (selectedFiles) => {
    if (busy) return;
    const files = Array.from(selectedFiles).filter(
      (file) => stimulusInfo(file.name)?.type === settings.stimulusType,
    );
    if (!files.length) {
      setError(
        imageStudy
          ? "Wybierz zdjęcia w formacie JPG, PNG lub WebP albo folder zawierający takie zdjęcia."
          : "Wybierz filmy w formacie MP4 albo folder zawierający takie filmy.",
      );
      return;
    }
    setBusy(true);
    setError("");
    let imported = [],
      failures = [];
    for (let i = 0; i < files.length; i++) {
      setMessage(
        adminMessage("Dodawanie pliku {current} z {total}: {name}", {
          current: i + 1,
          total: files.length,
          name: files[i].name,
        }),
      );
      const form = new FormData();
      form.append("video", files[i]);
      try {
        const { data } = await axios.post(
          `/api/admin/upload?type=${settings.stimulusType}`,
          form,
        );
        imported.push(data.name);
      } catch (e) {
        failures.push(
          e.response?.data?.error ||
            `Nie udało się dodać pliku ${files[i].name}`,
        );
      }
    }
    try {
      const { data } = await axios.get("/api/admin/config");
      setCatalog(data.catalog);
      if (imported.length)
        change({
          selectedVideos: [
            ...new Set([...settings.selectedVideos, ...imported]),
          ],
        });
    } catch (e) {
      fail(e);
    }
    setMessage(
      adminMessage(
        "Dodane pliki: {count} z {total}. Zapisz ustawienia, aby użyć ich w badaniu.",
        { count: imported.length, total: files.length },
      ),
    );
    if (failures.length) setError(failures);
    setBusy(false);
  };
  const chooseStimuli = (event) => {
    const files = Array.from(event.target.files);
    event.target.value = "";
    if (files.length) importStimuli(files);
  };
  const importCsv = async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    try {
      const rows = questionRows(
        await file.text(),
        catalog.map((video) => video.name),
      );
      changeQuestions(rows);
      setRawCsv(null);
      setError("");
      setMessage(
        adminMessage(
          "Wczytano pytania z pliku: {count}. Zapisz ustawienia, aby użyć ich w badaniu.",
          { count: rows.length },
        ),
      );
    } catch (e) {
      fail(e);
    }
  };
  const removeStimulus = async () => {
    if (!pendingDeletion || busy) return;
    const file = pendingDeletion;
    setBusy(true);
    setDeletionError("");
    setMessage("");
    setError("");
    try {
      const nextRawCsv =
        rawCsv === null ? null : removeStimulusQuestions(rawCsv, file.name);
      const { data } = await axios.delete("/api/admin/stimuli", {
        data: { name: file.name },
      });
      setCatalog(data.catalog);
      setVersion(data.version);
      setSettings((previous) => ({
        ...previous,
        selectedVideos: previous.selectedVideos.filter(
          (name) => name !== file.name,
        ),
      }));
      setSelectionsByType((previous) =>
        Object.fromEntries(
          Object.entries(previous).map(([type, names]) => [
            type,
            names.filter((name) => name !== file.name),
          ]),
        ),
      );
      setQuestions((previous) =>
        previous.filter((question) => question.video_name !== file.name),
      );
      setRawCsv(nextRawCsv);
      setSelectedPreview((previous) => (previous === file.url ? "" : previous));
      setPendingDeletion(null);
      setMessage(
        adminMessage("Usunięto bodziec: {name}.", { name: file.name }),
      );
    } catch (e) {
      setDeletionError(
        e.response?.data?.error ||
          e.message ||
          "Nie udało się usunąć bodźca. Spróbuj ponownie.",
      );
      if (e.response?.status === 401) {
        fail(e);
        setPendingDeletion(null);
      }
    } finally {
      setBusy(false);
    }
  };
  const showResults = async () => {
    setTab("results");
    setError("");
    try {
      const { data } = await axios.get("/api/admin/results");
      setStats(data);
    } catch (e) {
      fail(e);
    }
  };
  const exportResults = async (type) => {
    setBusy(true);
    setError("");
    try {
      const database = type === "database";
      const url = database
        ? "/api/admin/results?type=database"
        : `/api/admin/results?type=${type}&complete=${completeOnly ? "1" : "0"}`;
      const { data } = await axios.get(url, { responseType: "blob" });
      download(
        database ? "study-results.sqlite" : `${type}.csv`,
        data,
        database ? "application/vnd.sqlite3" : "text/csv;charset=utf-8",
      );
    } catch (e) {
      setError(
        adminMessage("Nie udało się pobrać wyników ({status}).", {
          status: e.response?.status || adminMessage("błąd połączenia"),
        }),
      );
    } finally {
      setBusy(false);
    }
  };
  const deleteResults = async () => {
    if (busy || resultsDeletionStep !== 2) return;
    setBusy(true);
    setResultsDeletionError("");
    setError("");
    setMessage("");
    try {
      const { data } = await axios.delete("/api/admin/results", {
        data: { confirmation: "DELETE_ALL_RESULTS" },
      });
      setStats(data);
      setResultsDeletionStep(0);
      setMessage("Wszystkie wyniki zostały usunięte.");
    } catch (e) {
      if (e.response?.status === 401) {
        setResultsDeletionStep(0);
        fail(e);
      } else
        setResultsDeletionError(
          e.response?.data?.error ||
            "Nie udało się usunąć wyników. Spróbuj ponownie.",
        );
    } finally {
      setBusy(false);
    }
  };
  const trans = (key) =>
    settings?.texts[locale]?.[key] ?? (locale === "pl" ? pl : en)[key] ?? key;
  if (loading)
    return (
      <main className="study-background" lang={adminLocale}>
        {t("Wczytywanie panelu…")}
      </main>
    );
  if (access || !settings)
    return (
      <main className="study-background" lang={adminLocale}>
        <section className="study-card">
          <AdminLanguageSwitcher
            locale={adminLocale}
            onChange={changeAdminLocale}
            label={t("Język panelu")}
          />
          <h1 className="text-2xl font-bold mb-3">
            {t("Panel administratora")}
          </h1>
          {access?.passwordRequired ? (
            <>
              <p className="admin-note">
                {t(
                  "Zaloguj się hasłem albo wcześniej dodanym kluczem dostępu. Pierwszy klucz dostępu dodasz po zalogowaniu w zakładce Dostęp.",
                )}
              </p>
              <button
                className="admin-primary w-full mb-5"
                onClick={loginWithPasskey}
                disabled={busy || !passkeySupported}
              >
                {busy
                  ? t("Oczekiwanie na potwierdzenie…")
                  : t("Zaloguj się kluczem dostępu")}
              </button>
              {!passkeySupported && (
                <p className="admin-note">
                  {t(
                    "Klucz dostępu wymaga obsługującej go przeglądarki. Otwórz panel pod adresem zaczynającym się od https:// albo na tym komputerze przez localhost.",
                  )}
                </p>
              )}
              <form onSubmit={login}>
                <Field label={t("Hasło administratora")}>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </Field>
                <button className="study-button mt-4" disabled={busy}>
                  {t("Zaloguj się hasłem")}
                </button>
              </form>
            </>
          ) : (
            <p>{t(access?.error || "Nie udało się wczytać ustawień.")}</p>
          )}
          {error && (
            <p className="admin-error" role="alert">
              {t(error)}
            </p>
          )}
          <Link className="admin-link" href="/">
            {t("Wróć do badania")}
          </Link>
        </section>
      </main>
    );
  return (
    <>
      <Head>
        <title>
          {t("Panel administratora")} · {settings.title}
        </title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <div className="admin-layout" lang={adminLocale}>
        <aside className="admin-sidebar">
          <div className="admin-sidebar-content">
            <Link href="/admin" className="admin-brand">
              <span className="admin-logo">VQ</span>
              <span>
                Video Quality<small>{t("Panel administratora")}</small>
              </span>
            </Link>
            <nav aria-label={t("Ustawienia badania")}>
              {tabs.map(([key, title], index) => (
                <button
                  key={key}
                  disabled={busy}
                  aria-current={tab === key ? "page" : undefined}
                  className={tab === key ? "active" : ""}
                  onClick={() => {
                    if (key === "results") showResults();
                    else {
                      setTab(key);
                      if (key === "access") loadPasskeys();
                    }
                  }}
                >
                  <span>0{index + 1}</span>
                  {t(title)}
                </button>
              ))}
            </nav>
            <div className="admin-sidebar-footer">
              <p>
                {passwordProtected
                  ? t("Dostęp chroniony hasłem")
                  : t("Dostęp na tym komputerze · localhost")}
              </p>
              <Link href="/" target="_blank">
                {t("Otwórz badanie ↗")}
              </Link>
              {passwordProtected && (
                <button
                  disabled={busy}
                  onClick={async () => {
                    await axios.delete("/api/admin/auth");
                    setSettings(null);
                    setAccess({ passwordRequired: true });
                    setPasskeys([]);
                    setError("");
                    setMessage("");
                  }}
                >
                  {t("Wyloguj się")}
                </button>
              )}
            </div>
          </div>
        </aside>
        <main className="admin-main">
          <header className="admin-header">
            <div>
              <p className="admin-eyebrow">{t("USTAWIENIA BADANIA")}</p>
              <h1>{settings.title}</h1>
              <p>
                {dirty
                  ? t("Niezapisane zmiany")
                  : t("Zapisana wersja · {version}", {
                      version: version || t("ustawienia początkowe"),
                    })}
              </p>
            </div>
            <div className="admin-header-actions">
              <AdminLanguageSwitcher
                locale={adminLocale}
                onChange={changeAdminLocale}
                label={t("Język panelu")}
              />
              <button
                className="admin-primary"
                onClick={save}
                disabled={busy || !dirty || !settings.selectedVideos.length}
              >
                {busy ? t("Przetwarzanie…") : t("Zapisz ustawienia")}
              </button>
            </div>
          </header>
          <div className="admin-summary">
            <span>
              {t("Bodźce:")} <strong>{settings.selectedVideos.length}</strong>
            </span>
            <span>
              {t("Części badania:")}{" "}
              <strong>{settings.mode === "both" ? 2 : 1}</strong>
            </span>
            <span>
              {t("Pytania kontrolne:")} <strong>{activeQuestionCount}</strong>
            </span>
            <span>{t("Zmiany dotyczą osób rozpoczynających badanie")}</span>
          </div>
          {error && (
            <div role="alert" className="admin-error">
              {t(error)}
            </div>
          )}
          {message && (
            <div role="status" className="admin-message">
              {t(message)}
            </div>
          )}
          <fieldset className="admin-editor" disabled={busy}>
            {tab === "videos" && (
              <section className="admin-section">
                <div className="admin-section-heading">
                  <div>
                    <h2>{t("Bodźce")}</h2>
                    <p>
                      {t(
                        "Wybierz bodźce, czyli filmy lub zdjęcia, które uczestnicy zobaczą w badaniu.",
                      )}
                    </p>
                  </div>
                  <div className="admin-actions">
                    <label className="admin-secondary admin-file">
                      {t("Dodaj folder")}
                      <input
                        type="file"
                        multiple
                        webkitdirectory=""
                        directory=""
                        onChange={chooseStimuli}
                      />
                    </label>
                    <label className="admin-secondary admin-file">
                      {imageStudy ? t("Dodaj zdjęcia") : t("Dodaj filmy")}
                      <input
                        type="file"
                        accept={
                          imageStudy
                            ? ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                            : "video/mp4,.mp4"
                        }
                        multiple
                        onChange={chooseStimuli}
                      />
                    </label>
                  </div>
                </div>
                <Field label={t("Rodzaj bodźców")}>
                  <select
                    value={settings.stimulusType}
                    onChange={(e) => changeStimulusType(e.target.value)}
                  >
                    <option value="video">{t("Filmy (MP4)")}</option>
                    <option value="image">
                      {t("Zdjęcia (JPG, PNG, WebP)")}
                    </option>
                  </select>
                </Field>
                <p className="admin-note">
                  {imageStudy
                    ? t(
                        "Możesz dodać zdjęcia JPG, PNG i WebP o rozmiarze do 50 MB każde. Czas wyświetlania ustawisz w zakładce Przebieg i skale.",
                      )
                    : t(
                        "Możesz dodać filmy MP4 o rozmiarze do 2 GB każdy.",
                      )}{" "}
                  {t(
                    "Dodawanie plików nie zmienia wcześniej dodanych materiałów. W jednym badaniu można używać filmów albo zdjęć.",
                  )}
                </p>
                <div className="admin-actions mb-5">
                  <button
                    className="admin-small"
                    onClick={() =>
                      change({
                        selectedVideos: activeCatalog.map((file) => file.name),
                      })
                    }
                  >
                    {t("Wybierz wszystkie")}
                  </button>
                  <button
                    className="admin-small"
                    onClick={() => change({ selectedVideos: [] })}
                  >
                    {t("Odznacz wszystkie")}
                  </button>
                </div>
                <StimulusDropZone
                  imageStudy={imageStudy}
                  busy={busy}
                  onFiles={importStimuli}
                  onError={setError}
                  t={t}
                />
                {settings.selectedVideos
                  .filter(
                    (name) => !activeCatalog.some((file) => file.name === name),
                  )
                  .map((name) => (
                    <div key={name} className="admin-error">
                      {t("Niedostępny bodziec:")} {name}{" "}
                      <button
                        onClick={() =>
                          change({
                            selectedVideos: settings.selectedVideos.filter(
                              (item) => item !== name,
                            ),
                          })
                        }
                      >
                        {t("Odznacz")}
                      </button>
                    </div>
                  ))}
                <div className="admin-video-list">
                  {activeCatalog.map((file) => (
                    <div key={file.name} className="admin-video-row">
                      <label>
                        <input
                          type="checkbox"
                          checked={settings.selectedVideos.includes(file.name)}
                          onChange={(e) =>
                            change({
                              selectedVideos: e.target.checked
                                ? [...settings.selectedVideos, file.name]
                                : settings.selectedVideos.filter(
                                    (name) => name !== file.name,
                                  ),
                            })
                          }
                        />
                        <span>
                          {file.name}
                          <small>
                            {(file.size / 1024 ** 2).toLocaleString(
                              adminLocale,
                              {
                                minimumFractionDigits: 1,
                                maximumFractionDigits: 1,
                              },
                            )}{" "}
                            MB
                          </small>
                        </span>
                      </label>
                      <div className="admin-video-row-actions">
                        <button
                          type="button"
                          className="admin-small"
                          onClick={() => setSelectedPreview(file.url)}
                        >
                          {t("Podgląd")}
                        </button>
                        <button
                          type="button"
                          className="admin-remove"
                          onClick={() => {
                            setPendingDeletion(file);
                            setDeletionError("");
                          }}
                        >
                          {t("Usuń")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {tab === "flow" && (
              <section className="admin-section">
                <h2>{t("Przebieg i skale")}</h2>
                <p className="admin-note">
                  {t(
                    "W obu częściach badania uczestnik zobaczy te same bodźce w tej samej kolejności.",
                  )}
                </p>
                <div className="admin-grid">
                  <Field label={t("Nazwa badania")}>
                    <input
                      value={settings.title}
                      maxLength={200}
                      onChange={(e) => change({ title: e.target.value })}
                    />
                  </Field>
                  <Field label={t("Sposób oceny")}>
                    <select
                      value={settings.mode}
                      onChange={(e) => change({ mode: e.target.value })}
                    >
                      {Object.entries(modes).map(([key, value]) => (
                        <option value={key} key={key}>
                          {t(value)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label={t("Kolejność skal")}
                    hint={
                      settings.mode === "both"
                        ? t(
                            "Połowa uczestników zaczyna od przycisków, a połowa od suwaka. Podział dotyczy tej samej wersji ustawień. Przy nieparzystej liczbie uczestników różnica wynosi jedną osobę.",
                          )
                        : t("Kolejność dotyczy badania z obiema skalami.")
                    }
                  >
                    <select
                      value={settings.phaseOrder}
                      disabled={settings.mode !== "both"}
                      onChange={(e) => change({ phaseOrder: e.target.value })}
                    >
                      {Object.entries(phaseOrders).map(([key, value]) => (
                        <option key={key} value={key}>
                          {t(value)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label={t("Krok suwaka")}
                    hint={t("Najmniejsza zmiana oceny na suwaku.")}
                  >
                    <select
                      value={settings.sliderStep}
                      disabled={settings.mode === "standard"}
                      onChange={(e) =>
                        change({ sliderStep: Number(e.target.value) })
                      }
                    >
                      {[0.01, 0.1, 0.25, 0.5, 1].map((step) => (
                        <option key={step} value={step}>
                          {step.toLocaleString(adminLocale)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t("Kolejność bodźców")}>
                    <select
                      value={String(settings.randomize)}
                      onChange={(e) =>
                        change({ randomize: e.target.value === "true" })
                      }
                    >
                      <option value="true">
                        {t("Losowa dla każdego uczestnika")}
                      </option>
                      <option value="false">
                        {t("Według kolejności wyboru bodźców")}
                      </option>
                    </select>
                  </Field>
                  <Field
                    label={t("Czas wyświetlania zdjęcia (s)")}
                    muted={!imageStudy}
                    hint={t(
                      "Od 0,5 do 300 sekund. Czas jest liczony od wczytania zdjęcia. Potem pojawia się skala oceny.",
                    )}
                  >
                    <input
                      type="number"
                      min="0.5"
                      max="300"
                      step="0.1"
                      disabled={!imageStudy}
                      value={settings.imageDuration}
                      onChange={(e) =>
                        change({
                          imageDuration:
                            e.target.value === "" ? "" : Number(e.target.value),
                        })
                      }
                    />
                  </Field>
                  <div className="admin-field admin-color-field">
                    <label htmlFor="study-background-hex">
                      {t("Kolor tła strony testu")}
                    </label>
                    <div className="admin-color-controls">
                      <input
                        type="color"
                        aria-label={t("Wybierz kolor tła")}
                        value={settings.backgroundColor}
                        onChange={(e) => changeBackgroundColor(e.target.value)}
                      />
                      <input
                        id="study-background-hex"
                        className="admin-color-hex"
                        type="text"
                        value={backgroundColorDraft}
                        maxLength={7}
                        spellCheck={false}
                        autoComplete="off"
                        aria-invalid={backgroundColorInvalid}
                        aria-describedby="study-background-hint"
                        style={{
                          backgroundColor: settings.backgroundColor,
                          color: colorText(settings.backgroundColor),
                        }}
                        onChange={(e) => changeBackgroundColor(e.target.value)}
                      />
                    </div>
                    <small
                      id="study-background-hint"
                      className={
                        backgroundColorInvalid ? "admin-color-error" : ""
                      }
                    >
                      {backgroundColorInvalid
                        ? t("Wpisz kolor tła w formacie #RRGGBB.")
                        : t(
                            "Kolor tła widoczny podczas badania. Sprawdź go w zakładce Podgląd.",
                          )}
                    </small>
                  </div>
                </div>
                <label className="admin-check">
                  <input
                    type="checkbox"
                    checked={settings.screenTest}
                    onChange={(e) => change({ screenTest: e.target.checked })}
                  />
                  {t("Test ekranu przed oceną bodźców")}
                </label>
                <label className="admin-check">
                  <input
                    type="checkbox"
                    checked={settings.autoFullscreen}
                    onChange={(e) =>
                      change({ autoFullscreen: e.target.checked })
                    }
                  />
                  {t("Automatyczny tryb pełnoekranowy")}
                </label>
                <p className="admin-note">
                  {t(
                    "Automatycznie wyświetla bodźce na pełnym ekranie, jeśli urządzenie obsługuje tę funkcję. Ustawienie dotyczy wszystkich osób rozpoczynających badanie.",
                  )}
                </p>
                <h3>{t("Opisy punktów skali")}</h3>
                <p className="admin-note">
                  {t(
                    "Wspólne dla przycisków i suwaka. Zakres oceny: od 1 do 5.",
                  )}
                </p>
                <div
                  className="admin-languages"
                  role="group"
                  aria-label={t("Język tekstów badania")}
                >
                  {["pl", "en"].map((language) => (
                    <button
                      key={language}
                      aria-pressed={locale === language}
                      onClick={() => setLocale(language)}
                    >
                      {language === "pl" ? t("Polski") : t("Angielski")}
                    </button>
                  ))}
                </div>
                <div className="admin-scale-labels">
                  {settings.labels[locale].map((label, i) => (
                    <Field key={i} label={`${i + 1}`}>
                      <input
                        value={label}
                        maxLength={100}
                        onChange={(e) =>
                          change({
                            labels: {
                              ...settings.labels,
                              [locale]: settings.labels[locale].map(
                                (text, index) =>
                                  index === i ? e.target.value : text,
                              ),
                            },
                          })
                        }
                      />
                    </Field>
                  ))}
                </div>
              </section>
            )}
            {tab === "texts" && (
              <section className="admin-section">
                <div className="admin-section-heading">
                  <div>
                    <h2>{t("Teksty ekranów")}</h2>
                    <p>
                      {t(
                        "Instrukcje i podziękowanie w dwóch wersjach językowych.",
                      )}
                    </p>
                  </div>
                  <div
                    className="admin-languages"
                    role="group"
                    aria-label={t("Język tekstów badania")}
                  >
                    {["pl", "en"].map((language) => (
                      <button
                        key={language}
                        aria-pressed={locale === language}
                        onClick={() => setLocale(language)}
                      >
                        {language === "pl" ? t("Polski") : t("Angielski")}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="admin-grid">
                  {textFields
                    .filter(
                      ([key]) =>
                        settings.mode === "both" ||
                        ![
                          "two_parts_instruction",
                          "part_two",
                          "slider_instruction",
                          "standard_part_two",
                          "standard_instruction",
                        ].includes(key),
                    )
                    .map(([key, label]) => (
                      <Field key={key} label={t(label)}>
                        <textarea
                          rows={
                            key === "instruction" || key.endsWith("instruction")
                              ? 4
                              : 2
                          }
                          value={settings.texts[locale][key]}
                          maxLength={10000}
                          onChange={(e) =>
                            change({
                              texts: {
                                ...settings.texts,
                                [locale]: {
                                  ...settings.texts[locale],
                                  [key]: e.target.value,
                                },
                              },
                            })
                          }
                        />
                      </Field>
                    ))}
                </div>
              </section>
            )}
            {tab === "questions" && (
              <section className="admin-section">
                <div className="admin-section-heading">
                  <div>
                    <h2>{t("Pytania kontrolne")}</h2>
                    <p>
                      {t(
                        "Pytania z odpowiedzią „tak” lub „nie” pojawią się po ocenie wybranego bodźca we wskazanych częściach badania.",
                      )}
                    </p>
                  </div>
                  <div className="admin-actions">
                    <label className="admin-secondary admin-file">
                      {t("Wczytaj pytania z CSV")}
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        onChange={importCsv}
                      />
                    </label>
                    <button
                      className="admin-secondary"
                      onClick={() =>
                        download(
                          "control-questions.csv",
                          rawCsv ?? questionsToCsv(questions, settings),
                          "text/csv;charset=utf-8",
                        )
                      }
                    >
                      {t("Pobierz pytania w CSV")}
                    </button>
                  </div>
                </div>
                <p className="admin-note">
                  {t(
                    "W pliku CSV podaj kolumny: stimulus_name (lub video_name) — nazwa pliku bodźca, question — treść pytania, correct_answer — poprawna odpowiedź (tak lub nie, opcjonalnie), part — część badania (first: pierwsza, second: druga, both: obie). Nazwa pliku bodźca może wskazywać film lub zdjęcie. Brak kolumny part lub puste pole oznacza pierwszą część. Uczestnik nie widzi poprawnej odpowiedzi. Wczytanie pliku zastępuje pytania w edytorze.",
                  )}
                </p>
                <p className="admin-note">
                  {settings.mode === "both"
                    ? t(
                        "Pierwsza i druga część oznaczają kolejność wyświetlania, niezależnie od tego, od której skali zaczyna uczestnik. Nowe pytania domyślnie pojawiają się w obu częściach.",
                      )
                    : t(
                        "Badanie ma jedną część, więc wszystkie pytania pojawią się w tej części. Po ponownym włączeniu obu skal pytania wrócą do wcześniej wybranych części badania.",
                      )}
                </p>
                {rawCsv !== null ? (
                  <>
                    <Field label={t("Treść pliku CSV do poprawienia")}>
                      <textarea
                        rows={12}
                        value={rawCsv}
                        onChange={(e) => {
                          setRawCsv(e.target.value);
                          setDirty(true);
                        }}
                      />
                    </Field>
                    <button
                      className="admin-secondary mt-4"
                      onClick={() => {
                        try {
                          changeQuestions(
                            questionRows(
                              rawCsv,
                              catalog.map((file) => file.name),
                            ),
                          );
                          setRawCsv(null);
                          setError("");
                        } catch (e) {
                          fail(e);
                        }
                      }}
                    >
                      {t("Sprawdź i otwórz tabelę")}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="admin-questions">
                      {questions.map((question, i) => (
                        <div key={i} className="admin-question">
                          <strong>
                            {t("Pytanie {number}", { number: i + 1 })}
                          </strong>
                          <Field label={t("Bodziec")}>
                            <select
                              value={question.video_name}
                              onChange={(e) =>
                                changeQuestions(
                                  questions.map((row, index) =>
                                    index === i
                                      ? { ...row, video_name: e.target.value }
                                      : row,
                                  ),
                                )
                              }
                            >
                              <option value="">{t("Wybierz bodziec")}</option>
                              {catalog.map((file) => (
                                <option key={file.name} value={file.name}>
                                  {file.name}
                                  {settings.selectedVideos.includes(file.name)
                                    ? ""
                                    : t(" (poza badaniem)")}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label={t("Treść pytania")}>
                            <textarea
                              rows={2}
                              value={question.question}
                              onChange={(e) =>
                                changeQuestions(
                                  questions.map((row, index) =>
                                    index === i
                                      ? { ...row, question: e.target.value }
                                      : row,
                                  ),
                                )
                              }
                            />
                          </Field>
                          <Field label={t("Poprawna odpowiedź")}>
                            <select
                              value={question.correct_answer}
                              onChange={(e) =>
                                changeQuestions(
                                  questions.map((row, index) =>
                                    index === i
                                      ? {
                                          ...row,
                                          correct_answer: e.target.value,
                                        }
                                      : row,
                                  ),
                                )
                              }
                            >
                              <option value="">{t("Nie określono")}</option>
                              <option value="tak">{t("Tak")}</option>
                              <option value="nie">{t("Nie")}</option>
                            </select>
                          </Field>
                          <Field label={t("Kiedy wyświetlić pytanie")}>
                            <select
                              value={
                                settings.mode === "both"
                                  ? question.part
                                  : "single"
                              }
                              disabled={settings.mode !== "both"}
                              onChange={(e) =>
                                changeQuestions(
                                  questions.map((row, index) =>
                                    index === i
                                      ? { ...row, part: e.target.value }
                                      : row,
                                  ),
                                )
                              }
                            >
                              {settings.mode === "both" ? (
                                Object.entries(questionParts).map(
                                  ([key, value]) => (
                                    <option key={key} value={key}>
                                      {t(value)}
                                    </option>
                                  ),
                                )
                              ) : (
                                <option value="single">
                                  {t("Jedyna część badania")}
                                </option>
                              )}
                            </select>
                          </Field>
                          <button
                            className="admin-remove"
                            onClick={() =>
                              changeQuestions(
                                questions.filter((row, index) => index !== i),
                              )
                            }
                          >
                            {t("Usuń pytanie {number}", { number: i + 1 })}
                          </button>
                        </div>
                      ))}
                    </div>
                    {!questions.length && (
                      <div className="admin-empty">
                        {t(
                          "Brak pytań kontrolnych. Dodaj pytanie lub wczytaj plik CSV.",
                        )}
                      </div>
                    )}
                    <button
                      className="admin-secondary mt-5"
                      disabled={!activeCatalog.length}
                      onClick={() =>
                        changeQuestions([
                          ...questions,
                          {
                            video_name:
                              settings.selectedVideos[0] ||
                              activeCatalog[0]?.name ||
                              "",
                            question: "",
                            correct_answer: "",
                            part: "both",
                          },
                        ])
                      }
                    >
                      {t("+ Dodaj pytanie")}
                    </button>
                  </>
                )}
              </section>
            )}
            {tab === "preview" && (
              <section className="admin-section">
                <h2>{t("Podgląd ekranów")}</h2>
                <p className="admin-note">
                  {t(
                    "Podgląd pokazuje ekrany zgodnie z bieżącymi ustawieniami. Oglądanie podglądu nie jest zapisywane jako udział w badaniu, a wybrane oceny nie trafiają do wyników.",
                  )}
                </p>
                <div className="admin-actions mb-5">
                  <select
                    aria-label={t("Ekran podglądu")}
                    value={previewScreen}
                    onChange={(e) => {
                      setPreviewScreen(e.target.value);
                      setPreviewRating(null);
                    }}
                  >
                    <option value="start">{t("Powitanie")}</option>
                    {settings.mode !== "slider" && (
                      <option value="standard">
                        {t("Skala z przyciskami")}
                      </option>
                    )}
                    {settings.mode !== "standard" && (
                      <option value="slider">{t("Skala z suwakiem")}</option>
                    )}
                    {settings.mode === "both" && (
                      <option value="intro">
                        {t("Przejście między częściami")}
                      </option>
                    )}
                    <option value="end">{t("Podziękowanie")}</option>
                  </select>
                  <select
                    aria-label={t("Język podglądu")}
                    value={locale}
                    onChange={(e) => setLocale(e.target.value)}
                  >
                    <option value="pl">{t("Polski")}</option>
                    <option value="en">{t("Angielski")}</option>
                  </select>
                </div>
                {settings.mode === "both" &&
                  settings.phaseOrder === "balanced" && (
                    <Field
                      label={t("Kolejność w podglądzie")}
                      hint={t(
                        "Wybór w podglądzie nie zmienia kolejności skal przydzielanej uczestnikom.",
                      )}
                    >
                      <select
                        value={previewFirstPhase}
                        onChange={(e) => setPreviewFirstPhase(e.target.value)}
                      >
                        <option value="standard">
                          {t("Przyciski → suwak")}
                        </option>
                        <option value="slider">{t("Suwak → przyciski")}</option>
                      </select>
                    </Field>
                  )}
                <div
                  className="admin-preview"
                  lang={locale}
                  style={{ "--background": settings.backgroundColor }}
                >
                  {["start", "end"].includes(previewScreen) ? (
                    <StartScreen
                      endScreen={previewScreen === "end"}
                      trans={trans}
                      mode={settings.mode}
                      disabled
                      onStart={() => {}}
                    />
                  ) : previewScreen === "intro" ? (
                    <div className="study-background">
                      <section className="study-card text-center">
                        <h1 className="text-2xl font-bold">
                          {trans(previewIntroKeys.title)}
                        </h1>
                        <p className="study-description mb-6 whitespace-pre-line">
                          {trans(previewIntroKeys.instruction)}
                        </p>
                        <button className="study-button" disabled>
                          {trans("start_part_two")}
                        </button>
                      </section>
                    </div>
                  ) : (
                    <RatingPanel
                      key={`${previewScreen}-${locale}`}
                      trans={trans}
                      scale={previewScreen}
                      labels={settings.labels[locale]}
                      sliderStep={settings.sliderStep}
                      onChoose={(value) => setPreviewRating(value)}
                    />
                  )}
                </div>
                {previewRating !== null && (
                  <p className="admin-message">
                    {t(
                      "Wybrana ocena w podglądzie: {rating}. Nie została zapisana.",
                      { rating: previewRating },
                    )}
                  </p>
                )}
              </section>
            )}
            {tab === "results" && (
              <section className="admin-section">
                <h2>{t("Wyniki badania")}</h2>
                <p className="admin-note">
                  {t(
                    "Pobrane pliki zawierają dotychczas zebrane wyniki. Kolumna study_version wskazuje wersję ustawień badania.",
                  )}
                </p>
                {stats && (
                  <div className="admin-stat-grid">
                    {[
                      ["sessions", t("Rozpoczęte badania")],
                      ["completed", t("Ukończone badania")],
                      ["ratings", t("Oceny")],
                      ["answers", t("Odpowiedzi na pytania kontrolne")],
                    ].map(([key, label]) => (
                      <div key={key}>
                        <strong>{stats[key]}</strong>
                        <span>{t(label)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <label className="admin-check">
                  <input
                    type="checkbox"
                    checked={completeOnly}
                    onChange={(e) => setCompleteOnly(e.target.checked)}
                  />
                  {t("Pobierz tylko wyniki ukończonych badań")}
                </label>
                <div className="admin-actions">
                  <button
                    className="admin-secondary"
                    onClick={() => exportResults("ratings")}
                  >
                    {t("Pobierz oceny w CSV")}
                  </button>
                  <button
                    className="admin-secondary"
                    onClick={() => exportResults("answers")}
                  >
                    {t("Pobierz odpowiedzi w CSV")}
                  </button>
                  <button className="admin-small" onClick={showResults}>
                    {t("Odśwież statystyki")}
                  </button>
                </div>
                <div className="admin-results-database">
                  <button
                    type="button"
                    className="admin-secondary"
                    onClick={() => exportResults("database")}
                  >
                    {t("Pobierz bazę wyników (SQLite)")}
                  </button>
                  <p className="admin-note">
                    {t(
                      "Plik zawiera wszystkie sesje, oceny, odpowiedzi i testy ekranu, także z nieukończonych badań.",
                    )}
                  </p>
                </div>
                <div className="admin-results-danger">
                  <button
                    type="button"
                    className="admin-danger"
                    onClick={() => {
                      setResultsDeletionError("");
                      setResultsDeletionStep(1);
                    }}
                  >
                    {t("Usuń wszystkie wyniki")}
                  </button>
                </div>
              </section>
            )}
            {tab === "access" && (
              <section className="admin-section">
                <h2>{t("Dostęp do panelu")}</h2>
                <p className="admin-note">
                  {t(
                    "Klucz dostępu umożliwia logowanie bez wpisywania hasła, np. za pomocą odcisku palca, kodu PIN lub telefonu. Nadal możesz zalogować się hasłem administratora.",
                  )}
                </p>
                {passkeyError && (
                  <p role="alert" className="admin-error">
                    {t(passkeyError)}
                  </p>
                )}
                {!passwordProtected ? (
                  <p className="admin-note">
                    {t(
                      "Aby dodać klucz dostępu, ustaw hasło poleceniem npm run admin:password, uruchom ponownie serwer i zaloguj się hasłem.",
                    )}
                  </p>
                ) : (
                  <>
                    {passkeyAddress && (
                      <p className="admin-note">
                        {t("Klucze dostępu dla adresu:")}{" "}
                        <strong>{passkeyAddress}</strong>
                      </p>
                    )}
                    <div className="admin-passkey-add">
                      <Field label={t("Nazwa nowego klucza dostępu")}>
                        <input
                          value={passkeyName}
                          maxLength={100}
                          placeholder={t("np. MacBook lub telefon")}
                          onChange={(e) => setPasskeyName(e.target.value)}
                        />
                      </Field>
                      <button
                        className="admin-primary"
                        disabled={
                          busy ||
                          !passkeySupported ||
                          !passkeyName.trim() ||
                          !!passkeyError
                        }
                        onClick={addPasskey}
                      >
                        {t("Dodaj klucz dostępu")}
                      </button>
                    </div>
                    {!passkeySupported && (
                      <p className="admin-note">
                        {t(
                          "Otwórz panel w przeglądarce obsługującej klucze dostępu, pod adresem zaczynającym się od https:// albo na tym komputerze przez localhost.",
                        )}
                      </p>
                    )}
                    {passkeys.length ? (
                      <div className="admin-passkey-list">
                        {passkeys.map((key) => (
                          <div className="admin-video-row" key={key.id}>
                            <div>
                              <strong>{key.name}</strong>
                              <small>
                                {t(
                                  "Dodano: {created} · Ostatnie logowanie: {lastUsed}",
                                  {
                                    created: key.created_at,
                                    lastUsed:
                                      key.last_used_at ||
                                      t("jeszcze nie użyto"),
                                  },
                                )}
                              </small>
                            </div>
                            {removingKey === key.id ? (
                              <div className="admin-actions">
                                <button
                                  className="admin-remove"
                                  onClick={() => removePasskey(key.id)}
                                >
                                  {t("Potwierdź usunięcie")}
                                </button>
                                <button
                                  className="admin-small"
                                  onClick={() => setRemovingKey(null)}
                                >
                                  {t("Anuluj")}
                                </button>
                              </div>
                            ) : (
                              <button
                                className="admin-remove"
                                onClick={() => setRemovingKey(key.id)}
                              >
                                {t("Usuń klucz dostępu")}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      !passkeyError && (
                        <p className="admin-empty mt-5">
                          {t(
                            "Nie dodano jeszcze kluczy dostępu. Dodaj pierwszy klucz za pomocą przycisku powyżej.",
                          )}
                        </p>
                      )
                    )}
                    <p className="admin-note">
                      {t(
                        "Możesz dodać klucze dostępu z kilku urządzeń. Usunięcie klucza z panelu blokuje logowanie za jego pomocą. Klucz pozostaje zapisany w menedżerze haseł urządzenia.",
                      )}
                    </p>
                  </>
                )}
              </section>
            )}
          </fieldset>
        </main>
        {selectedPreview && (
          <StimulusPreview
            key={selectedPreview}
            src={selectedPreview}
            image={imageStudy}
            locale={adminLocale}
            onClose={() => setSelectedPreview("")}
          />
        )}
        {pendingDeletion && (
          <ConfirmStimulusDeletion
            file={pendingDeletion}
            locale={adminLocale}
            busy={busy}
            error={deletionError}
            onClose={() => setPendingDeletion(null)}
            onConfirm={removeStimulus}
          />
        )}
        {resultsDeletionStep > 0 && (
          <ConfirmResultsDeletion
            key={resultsDeletionStep}
            step={resultsDeletionStep}
            locale={adminLocale}
            busy={busy}
            error={resultsDeletionError}
            onClose={() => setResultsDeletionStep(0)}
            onNext={() => setResultsDeletionStep(2)}
            onConfirm={deleteResults}
          />
        )}
      </div>
    </>
  );
}
