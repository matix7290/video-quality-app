import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import axios from 'axios';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import StartScreen from '@/components/StartScreen';
import RatingPanel from '@/components/RatingPanel';
import { phases, phaseIntroKeys } from '@/utils/study-phases.cjs';
import { questionRows, questionsToCsv } from '@/utils/questions.cjs';
import { stimulusInfo } from '@/utils/stimuli.cjs';
import { adaptStudyTexts } from '@/utils/study-texts.cjs';
import pl from '@/public/locales/pl/common.json';
import en from '@/public/locales/en/common.json';

const tabs = [['videos', 'Stymuli'], ['flow', 'Przebieg i skale'], ['texts', 'Teksty ekranów'], ['questions', 'Pytania kontrolne'], ['preview', 'Podgląd'], ['results', 'Wyniki'], ['access', 'Dostęp']];
const textFields = [['welcome', 'Tytuł powitania'], ['instruction', 'Instrukcja'], ['instruction_loadings', 'Informacja o ładowaniu'], ['instruction_scoring', 'Wskazówka do oceny'], ['two_parts_instruction', 'Opis dwóch części'], ['thanks', 'Tytuł podziękowania'], ['end_info', 'Podziękowanie'], ['part_two', 'Tytuł drugiej części — suwak'], ['slider_instruction', 'Instrukcja drugiej części — suwak'], ['standard_part_two', 'Tytuł drugiej części — skala dyskretna'], ['standard_instruction', 'Instrukcja drugiej części — skala dyskretna'], ['rate_quality', 'Pytanie o ocenę']];
const modes = { both: 'Obie skale — dwie części', standard: 'Tylko skala dyskretna (przyciski 1–5)', slider: 'Tylko skala liniowa (suwak 1–5)' };
const questionParts = { first: 'Pierwsza część', second: 'Druga część', both: 'Obie części' };
const phaseOrders = { 'standard-first': 'Najpierw dyskretna, potem suwak', 'slider-first': 'Najpierw suwak, potem dyskretna', balanced: 'Na zmianę między uczestnikami (50/50)' };
function Field({ label, children, hint }) { return <label className="admin-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
function download(filename, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function Admin() {
  const [settings, setSettings] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [selectionsByType, setSelectionsByType] = useState({});
  const activeCatalog = catalog.filter(file => file.type === (settings?.stimulusType || 'video'));
  const imageStudy = settings?.stimulusType === 'image';
  const [questions, setQuestions] = useState([]);
  const [rawCsv, setRawCsv] = useState(null);
  const [version, setVersion] = useState(null);
  const [tab, setTab] = useState('videos');
  const [locale, setLocale] = useState('pl');
  const [previewScreen, setPreviewScreen] = useState('start');
  const [previewRating, setPreviewRating] = useState(null);
  const [previewFirstPhase, setPreviewFirstPhase] = useState('standard');
  const previewSequence = settings ? phases({ ...settings, phaseSequence: settings.mode === 'both' && settings.phaseOrder === 'balanced' ? [previewFirstPhase, previewFirstPhase === 'standard' ? 'slider' : 'standard'] : undefined }) : [];
  const previewIntroKeys = phaseIntroKeys(previewSequence[1]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [access, setAccess] = useState(null);
  const [password, setPassword] = useState('');
  const [passwordProtected, setPasswordProtected] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [passkeys, setPasskeys] = useState([]);
  const [passkeyName, setPasskeyName] = useState('');
  const [passkeyAddress, setPasskeyAddress] = useState('');
  const [passkeyError, setPasskeyError] = useState('');
  const [removingKey, setRemovingKey] = useState(null);
  const [selectedPreview, setSelectedPreview] = useState('');
  const [stats, setStats] = useState(null);
  const [completeOnly, setCompleteOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    try {
      const { data } = await axios.get('/api/admin/config');
      setSettings({ ...data.settings, selectedVideos: data.settings.selectedVideos || data.catalog.filter(file => file.type === data.settings.stimulusType).map(file => file.name) });
      setSelectionsByType({});
      setCatalog(data.catalog); setVersion(data.version); setPasswordProtected(data.passwordProtected);
      try { setQuestions(questionRows(data.questionsCsv, data.catalog.map(file => file.name))); setRawCsv(null); }
      catch (e) { setRawCsv(data.questionsCsv); setError(e.message); }
      if (data.warning) setError(data.warning);
      setAccess(null); setDirty(false);
    } catch (e) {
      if (e.response?.status === 401) setAccess(e.response.data);
      else setError(e.response?.data?.error || 'Nie udało się wczytać panelu.');
    } finally { setLoading(false); }
  };
  useEffect(() => { setPasskeySupported(window.isSecureContext && typeof window.PublicKeyCredential !== 'undefined'); load(); }, []);
  useEffect(() => {
    if (!settings) return;
    if ((settings.mode === 'slider' && previewScreen === 'standard') ||
        (settings.mode === 'standard' && previewScreen === 'slider') ||
        (settings.mode !== 'both' && previewScreen === 'intro')) {
      setPreviewScreen('start'); setPreviewRating(null);
    }
  }, [settings, previewScreen]);
  useEffect(() => {
    const warn = event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const change = patch => { setSettings(previous => ({ ...previous, ...patch })); setDirty(true); setMessage(''); };
  const changeStimulusType = type => {
    setSelectionsByType(previous => ({ ...previous, [settings.stimulusType]: settings.selectedVideos }));
    setSelectedPreview('');
    change({ stimulusType: type, selectedVideos: selectionsByType[type] ?? catalog.filter(file => file.type === type).map(file => file.name),
      texts: adaptStudyTexts(settings.texts, type) });
  };
  const changeQuestions = rows => { setQuestions(rows); setDirty(true); setMessage(''); };
  const fail = e => {
    setError(e.response?.data?.error || e.message || 'Operacja nie powiodła się.');
    if (e.response?.status === 401) setAccess(e.response.data);
  };
  const save = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const { data } = await axios.put('/api/admin/config', { settings, questionsCsv: rawCsv ?? questionsToCsv(questions, settings) });
      setSettings(data.settings); setVersion(data.version); setDirty(false);
      setQuestions(questionRows(data.questionsCsv, data.catalog.map(file => file.name))); setRawCsv(null);
      setMessage('Konfiguracja zapisana. Będzie używana w nowych sesjach.');
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const login = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try { await axios.post('/api/admin/auth', { password }); setPassword(''); await load(); }
    catch (e) { setError(e.response?.data?.error || 'Nie udało się zalogować. Spróbuj ponownie.'); } finally { setBusy(false); }
  };
  const browserError = e => {
    if (['NotAllowedError', 'AbortError'].includes(e.name)) return 'Anulowano potwierdzenie passkey lub upłynął czas. Możesz spróbować ponownie.';
    if (['InvalidStateError', 'SecurityError', 'NotSupportedError'].includes(e.name)) return 'Ta przeglądarka lub adres nie pozwala użyć tego passkey. Otwórz panel w Chrome lub Safari pod adresem localhost albo HTTPS.';
    return e.response?.data?.error || 'Nie udało się użyć passkey. Spróbuj ponownie lub zaloguj się hasłem.';
  };
  const loginWithPasskey = async () => {
    setBusy(true); setError('');
    try {
      const { data: optionsJSON } = await axios.post('/api/admin/passkeys', { action: 'authenticate-options' });
      const response = await startAuthentication({ optionsJSON });
      await axios.post('/api/admin/passkeys', { action: 'authenticate-verify', response });
      await load();
    } catch (e) { setError(browserError(e)); } finally { setBusy(false); }
  };
  const loadPasskeys = async () => {
    setPasskeyError('');
    try { const { data } = await axios.get('/api/admin/passkeys'); setPasskeys(data.keys); setPasskeyAddress(data.origin); }
    catch (e) { setPasskeyError(e.response?.data?.error || 'Nie udało się wczytać kluczy.'); if (e.response?.status === 401) setAccess(e.response.data); }
  };
  const addPasskey = async () => {
    setBusy(true); setPasskeyError(''); setMessage('');
    try {
      const { data: optionsJSON } = await axios.post('/api/admin/passkeys', { action: 'register-options', name: passkeyName });
      const response = await startRegistration({ optionsJSON });
      await axios.post('/api/admin/passkeys', { action: 'register-verify', response });
      setPasskeyName(''); await loadPasskeys(); setMessage('Passkey dodany. Możesz nim logować się do panelu.');
    } catch (e) { setPasskeyError(browserError(e)); } finally { setBusy(false); }
  };
  const removePasskey = async id => {
    setBusy(true); setPasskeyError('');
    try { await axios.delete('/api/admin/passkeys', { data: { id } }); setRemovingKey(null); await loadPasskeys(); setMessage('Klucz usunięty z panelu. Nie umożliwi już kolejnych logowań.'); }
    catch (e) { setPasskeyError(e.response?.data?.error || 'Nie udało się usunąć klucza.'); } finally { setBusy(false); }
  };
  const importStimuli = async event => {
    const files = Array.from(event.target.files).filter(file => stimulusInfo(file.name)?.type === settings.stimulusType); event.target.value = '';
    if (!files.length) { setError(imageStudy ? 'Wybrany folder nie zawiera zdjęć JPG, PNG lub WebP.' : 'Wybrany folder nie zawiera filmów MP4.'); return; }
    setBusy(true); setError(''); let imported = [], failures = [];
    for (let i = 0; i < files.length; i++) {
      setMessage(`Importowanie ${i + 1} z ${files.length}: ${files[i].name}`);
      const form = new FormData(); form.append('video', files[i]);
      try { const { data } = await axios.post(`/api/admin/upload?type=${settings.stimulusType}`, form); imported.push(data.name); }
      catch (e) { failures.push(e.response?.data?.error || `Nie udało się zaimportować ${files[i].name}`); }
    }
    try {
      const { data } = await axios.get('/api/admin/config'); setCatalog(data.catalog);
      if (imported.length) change({ selectedVideos: [...new Set([...settings.selectedVideos, ...imported])] });
    } catch (e) { fail(e); }
    setMessage(`Zaimportowano ${imported.length} z ${files.length} plików. Zapisz konfigurację, aby dodać je do badania.`);
    if (failures.length) setError(failures.join('\n'));
    setBusy(false);
  };
  const importCsv = async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    try { const rows = questionRows(await file.text(), catalog.map(video => video.name)); changeQuestions(rows); setRawCsv(null); setError(''); setMessage(`Wczytano ${rows.length} pytań. Zapisz konfigurację, aby ich użyć.`); }
    catch (e) { fail(e); }
  };
  const showResults = async () => {
    setTab('results'); setError('');
    try { const { data } = await axios.get('/api/admin/results'); setStats(data); } catch (e) { fail(e); }
  };
  const exportResults = async type => {
    setBusy(true); setError('');
    try { const { data } = await axios.get(`/api/admin/results?type=${type}&complete=${completeOnly ? '1' : '0'}`, { responseType: 'blob' }); download(`${type}.csv`, data, 'text/csv;charset=utf-8'); }
    catch (e) { setError(`Nie udało się pobrać wyników (${e.response?.status || 'błąd połączenia'}).`); } finally { setBusy(false); }
  };
  const trans = key => settings?.texts[locale]?.[key] ?? (locale === 'pl' ? pl : en)[key] ?? key;
  if (loading) return <main className="study-background">Wczytywanie panelu…</main>;
  if (access || !settings) return <main className="study-background"><section className="study-card"><h1 className="text-2xl font-bold mb-3">Panel administratora</h1>
    {access?.passwordRequired ? <><p className="admin-note">Zaloguj się hasłem albo wcześniej dodanym passkey. Pierwszy klucz dodasz po zalogowaniu w zakładce Dostęp.</p><button className="admin-primary w-full mb-5" onClick={loginWithPasskey} disabled={busy || !passkeySupported}>{busy ? 'Oczekiwanie na potwierdzenie…' : 'Zaloguj się passkey'}</button>{!passkeySupported && <p className="admin-note">Passkey wymaga obsługującej go przeglądarki oraz HTTPS lub localhost.</p>}<form onSubmit={login}><Field label="Hasło administratora"><input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></Field><button className="study-button mt-4" disabled={busy}>Zaloguj się hasłem</button></form></> : <p>{access?.error || 'Nie udało się wczytać konfiguracji.'}</p>}
    {error && <p className="admin-error" role="alert">{error}</p>}<Link className="admin-link" href="/">Wróć do badania</Link></section></main>;
  return <>
    <Head><title>Panel administratora · {settings.title}</title><meta name="robots" content="noindex,nofollow" /></Head>
    <div className="admin-layout">
      <aside className="admin-sidebar"><div className="admin-sidebar-content"><Link href="/admin" className="admin-brand"><span className="admin-logo">VQ</span><span>Video Quality<small>Panel administratora</small></span></Link>
        <nav aria-label="Konfiguracja badania">{tabs.map(([key, title], index) => <button key={key} disabled={busy} aria-current={tab === key ? 'page' : undefined} className={tab === key ? 'active' : ''} onClick={() => { if (key === 'results') showResults(); else { setTab(key); if (key === 'access') loadPasskeys(); } }}><span>0{index + 1}</span>{title}</button>)}</nav>
        <div className="admin-sidebar-footer"><p>{passwordProtected ? 'Dostęp chroniony hasłem' : 'Dostęp lokalny · localhost'}</p><Link href="/" target="_blank">Otwórz badanie ↗</Link>{passwordProtected && <button disabled={busy} onClick={async () => { await axios.delete('/api/admin/auth'); setSettings(null); setAccess({ passwordRequired: true }); setPasskeys([]); setError(''); setMessage(''); }}>Wyloguj się</button>}</div>
      </div></aside>
      <main className="admin-main"><header className="admin-header"><div><p className="admin-eyebrow">KONFIGURACJA BADANIA</p><h1>{settings.title}</h1><p>{dirty ? 'Niezapisane zmiany' : `Zapisana wersja · ${version || 'ustawienia początkowe'}`}</p></div><button className="admin-primary" onClick={save} disabled={busy || !dirty || !settings.selectedVideos.length}>{busy ? 'Przetwarzanie…' : 'Zapisz konfigurację'}</button></header>
        <div className="admin-summary"><span><strong>{settings.selectedVideos.length}</strong> wybranych stymulów</span><span><strong>{settings.mode === 'both' ? 2 : 1}</strong> części badania</span><span><strong>{questions.length}</strong> pytań kontrolnych</span><span>Zmiany dotyczą nowych sesji</span></div>
        {error && <div role="alert" className="admin-error">{error}</div>}{message && <div role="status" className="admin-message">{message}</div>}
        <fieldset className="admin-editor" disabled={busy}>
        {tab === 'videos' && <section className="admin-section">
          <div className="admin-section-heading"><div><h2>Stymuli</h2><p>Wybierz rodzaj materiałów i pliki, które uczestnicy zobaczą w badaniu.</p></div>
            <div className="admin-actions"><label className="admin-secondary admin-file">Importuj folder<input type="file" multiple webkitdirectory="" directory="" onChange={importStimuli} /></label>
              <label className="admin-secondary admin-file">{imageStudy ? 'Dodaj zdjęcia' : 'Dodaj MP4'}<input type="file" accept={imageStudy ? '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp' : 'video/mp4,.mp4'} multiple onChange={importStimuli} /></label></div>
          </div>
          <Field label="Rodzaj stymulów"><select value={settings.stimulusType} onChange={e => changeStimulusType(e.target.value)}><option value="video">Filmy (MP4)</option><option value="image">Zdjęcia (JPG, PNG, WebP)</option></select></Field>
          <p className="admin-note">{imageStudy ? 'Import kopiuje zdjęcia JPG, PNG i WebP na serwer aplikacji. Limit pojedynczego zdjęcia: 50 MB. Czas wyświetlania ustawisz w zakładce Przebieg i skale.' : 'Import kopiuje pliki MP4 na serwer aplikacji. Limit pojedynczego filmu: 2 GB.'} Istniejące pliki zachowują swoją zawartość. Każde badanie korzysta z jednego rodzaju stymulów.</p>
          <div className="admin-actions mb-5"><button className="admin-small" onClick={() => change({ selectedVideos: activeCatalog.map(file => file.name) })}>Wybierz wszystkie</button><button className="admin-small" onClick={() => change({ selectedVideos: [] })}>Odznacz wszystkie</button></div>
          {!activeCatalog.length && <div className="admin-empty">{imageStudy ? 'Dodaj zdjęcia lub folder ze zdjęciami, aby rozpocząć konfigurację.' : 'Dodaj folder ze stymulami, aby rozpocząć konfigurację.'}</div>}
          {settings.selectedVideos.filter(name => !activeCatalog.some(file => file.name === name)).map(name => <div key={name} className="admin-error">Niedostępny stymulus: {name} <button onClick={() => change({ selectedVideos: settings.selectedVideos.filter(item => item !== name) })}>Usuń z wyboru</button></div>)}
          <div className="admin-video-list">{activeCatalog.map(file => <div key={file.name} className="admin-video-row"><label><input type="checkbox" checked={settings.selectedVideos.includes(file.name)} onChange={e => change({ selectedVideos: e.target.checked ? [...settings.selectedVideos, file.name] : settings.selectedVideos.filter(name => name !== file.name) })} /><span>{file.name}<small>{(file.size / 1024 ** 2).toFixed(1)} MB</small></span></label><button className="admin-small" onClick={() => setSelectedPreview(selectedPreview === file.url ? '' : file.url)}>Podgląd</button></div>)}</div>
          {selectedPreview && (imageStudy ?
            // eslint-disable-next-line @next/next/no-img-element
            <img className="admin-image-preview" src={selectedPreview} alt="Podgląd wybranego zdjęcia" /> :
            <video key={selectedPreview} className="admin-video-preview" src={selectedPreview} controls preload="metadata" />)}
        </section>}
        {tab === 'flow' && <section className="admin-section"><h2>Przebieg i skale</h2><p className="admin-note">W obu częściach używamy tych samych stymulów i tej samej kolejności.</p><div className="admin-grid">
          <Field label="Nazwa badania"><input value={settings.title} maxLength={200} onChange={e => change({ title: e.target.value })} /></Field>
          <Field label="Części badania"><select value={settings.mode} onChange={e => change({ mode: e.target.value })}>{Object.entries(modes).map(([key, value]) => <option value={key} key={key}>{value}</option>)}</select></Field>
          <Field label="Kolejność skal" hint={settings.mode === 'both' ? 'Podział 50/50 dotyczy rozpoczynanych sesji w tej samej wersji badania. Przy nieparzystej liczbie sesji różnica wynosi jedną osobę.' : 'Kolejność dotyczy badania z obiema skalami.'}><select value={settings.phaseOrder} disabled={settings.mode !== 'both'} onChange={e => change({ phaseOrder: e.target.value })}>{Object.entries(phaseOrders).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></Field>
          <Field label="Krok suwaka"><select value={settings.sliderStep} disabled={settings.mode === 'standard'} onChange={e => change({ sliderStep: Number(e.target.value) })}>{[0.01, 0.1, 0.25, 0.5, 1].map(step => <option key={step} value={step}>{step.toLocaleString('pl')}</option>)}</select></Field>
          <Field label="Kolejność stymulów"><select value={String(settings.randomize)} onChange={e => change({ randomize: e.target.value === 'true' })}><option value="true">Losowa dla każdego uczestnika</option><option value="false">Według kolejności wyboru stymulów</option></select></Field>
          <Field label="Czas wyświetlania zdjęcia (s)" hint="Od 0,5 do 300 sekund. Czas liczony od wczytania zdjęcia; potem pojawia się ocena."><input type="number" min="0.5" max="300" step="0.1" disabled={!imageStudy} value={settings.imageDuration} onChange={e => change({ imageDuration: e.target.value === '' ? '' : Number(e.target.value) })} /></Field>
        </div><label className="admin-check"><input type="checkbox" checked={settings.screenTest} onChange={e => change({ screenTest: e.target.checked })} />Test ekranu przed oceną stymulów</label>
        <label className="admin-check"><input type="checkbox" checked={settings.autoFullscreen} onChange={e => change({ autoFullscreen: e.target.checked })} />Automatyczny tryb pełnoekranowy</label>
        <p className="admin-note">Automatycznie otwiera stymuli na pełnym ekranie na urządzeniach obsługujących tę funkcję. Ustawienie jest wspólne dla wszystkich uczestników i dotyczy nowych sesji.</p>
        <h3>Opisy punktów skali</h3><p className="admin-note">Wspólne dla przycisków i suwaka. Zakres oceny: od 1 do 5.</p><div className="admin-languages">{['pl', 'en'].map(language => <button key={language} aria-pressed={locale === language} onClick={() => setLocale(language)}>{language.toUpperCase()}</button>)}</div>
        <div className="admin-scale-labels">{settings.labels[locale].map((label, i) => <Field key={i} label={`${i + 1}`}><input value={label} maxLength={100} onChange={e => change({ labels: { ...settings.labels, [locale]: settings.labels[locale].map((text, index) => index === i ? e.target.value : text) } })} /></Field>)}</div>
        </section>}
        {tab === 'texts' && <section className="admin-section"><div className="admin-section-heading"><div><h2>Teksty ekranów</h2><p>Instrukcje i podziękowanie w dwóch wersjach językowych.</p></div><div className="admin-languages">{['pl', 'en'].map(language => <button key={language} aria-pressed={locale === language} onClick={() => setLocale(language)}>{language.toUpperCase()}</button>)}</div></div>
          <div className="admin-grid">{textFields.filter(([key]) => settings.mode === 'both' || !['two_parts_instruction', 'part_two', 'slider_instruction', 'standard_part_two', 'standard_instruction'].includes(key)).map(([key, label]) => <Field key={key} label={label}><textarea rows={key === 'instruction' || key.endsWith('instruction') ? 4 : 2} value={settings.texts[locale][key]} maxLength={10000} onChange={e => change({ texts: { ...settings.texts, [locale]: { ...settings.texts[locale], [key]: e.target.value } } })} /></Field>)}</div>
        </section>}
        {tab === 'questions' && <section className="admin-section"><div className="admin-section-heading"><div><h2>Pytania kontrolne</h2><p>Pytania tak/nie pojawią się po ocenie przypisanego stymulusu w wybranych częściach badania.</p></div><div className="admin-actions"><label className="admin-secondary admin-file">Importuj CSV<input type="file" accept=".csv,text/csv" onChange={importCsv} /></label><button className="admin-secondary" onClick={() => download('control-questions.csv', rawCsv ?? questionsToCsv(questions, settings), 'text/csv;charset=utf-8')}>Eksportuj CSV</button></div></div>
          <p className="admin-note">Kolumny CSV: stimulus_name (lub video_name), question, correct_answer, part. Nazwa stymulusu może wskazywać film lub zdjęcie. Wartości part: first, second, both. Brak kolumny lub puste pole oznacza pierwszą część, jak w starszych plikach. Klucz odpowiedzi jest opcjonalny i niewidoczny dla uczestnika. Import zastępuje tabelę w edytorze.</p>
          <p className="admin-note">{settings.mode === 'both' ? 'Pierwsza i druga część oznaczają kolejność wyświetlania, niezależnie od rodzaju skali i przydziału 50/50. Nowe pytania domyślnie pojawiają się w obu częściach.' : 'Badanie ma jedną część: wszystkie pytania pojawią się w tej części, a wybór przypisania jest zablokowany. Przypisania do dwóch części są zachowane i wrócą po ponownym włączeniu obu skal.'}</p>
          {rawCsv !== null ? <><Field label="CSV do poprawienia"><textarea rows={12} value={rawCsv} onChange={e => { setRawCsv(e.target.value); setDirty(true); }} /></Field><button className="admin-secondary mt-4" onClick={() => { try { changeQuestions(questionRows(rawCsv, catalog.map(file => file.name))); setRawCsv(null); setError(''); } catch (e) { fail(e); } }}>Sprawdź i otwórz tabelę</button></> : <>
          <div className="admin-questions">{questions.map((question, i) => <div key={i} className="admin-question"><strong>Pytanie {i + 1}</strong><Field label="Stymulus"><select value={question.video_name} onChange={e => changeQuestions(questions.map((row, index) => index === i ? { ...row, video_name: e.target.value } : row))}><option value="">Wybierz stymulus</option>{catalog.map(file => <option key={file.name} value={file.name}>{file.name}{settings.selectedVideos.includes(file.name) ? '' : ' (poza badaniem)'}</option>)}</select></Field><Field label="Treść pytania"><textarea rows={2} value={question.question} onChange={e => changeQuestions(questions.map((row, index) => index === i ? { ...row, question: e.target.value } : row))} /></Field><Field label="Poprawna odpowiedź"><select value={question.correct_answer} onChange={e => changeQuestions(questions.map((row, index) => index === i ? { ...row, correct_answer: e.target.value } : row))}><option value="">Bez klucza odpowiedzi</option><option value="tak">Tak</option><option value="nie">Nie</option></select></Field><Field label="Części wyświetlania"><select value={settings.mode === 'both' ? question.part : 'single'} disabled={settings.mode !== 'both'} onChange={e => changeQuestions(questions.map((row, index) => index === i ? { ...row, part: e.target.value } : row))}>{settings.mode === 'both' ? Object.entries(questionParts).map(([key, value]) => <option key={key} value={key}>{value}</option>) : <option value="single">Jedyna część badania</option>}</select></Field><button className="admin-remove" onClick={() => changeQuestions(questions.filter((row, index) => index !== i))}>Usuń pytanie {i + 1}</button></div>)}</div>
          {!questions.length && <div className="admin-empty">Brak pytań kontrolnych. Dodaj pytanie lub zaimportuj CSV.</div>}
          <button className="admin-secondary mt-5" disabled={!activeCatalog.length} onClick={() => changeQuestions([...questions, { video_name: settings.selectedVideos[0] || activeCatalog[0]?.name || '', question: '', correct_answer: '', part: 'both' }])}>+ Dodaj pytanie</button></>}
        </section>}
        {tab === 'preview' && <section className="admin-section"><h2>Podgląd ekranów</h2><p className="admin-note">Podgląd korzysta z ustawień w edytorze. Nie tworzy sesji ani nie zapisuje ocen.</p><div className="admin-actions mb-5"><select aria-label="Ekran podglądu" value={previewScreen} onChange={e => { setPreviewScreen(e.target.value); setPreviewRating(null); }}><option value="start">Powitanie</option>{settings.mode !== 'slider' && <option value="standard">Skala standardowa</option>}{settings.mode !== 'standard' && <option value="slider">Skala suwakowa</option>}{settings.mode === 'both' && <option value="intro">Przejście między częściami</option>}<option value="end">Podziękowanie</option></select><select aria-label="Język podglądu" value={locale} onChange={e => setLocale(e.target.value)}><option value="pl">Polski</option><option value="en">English</option></select></div>
          {settings.mode === 'both' && settings.phaseOrder === 'balanced' && <Field label="Kolejność w podglądzie" hint="Podgląd nie wpływa na przydział 50/50."><select value={previewFirstPhase} onChange={e => setPreviewFirstPhase(e.target.value)}><option value="standard">Dyskretna → suwak</option><option value="slider">Suwak → dyskretna</option></select></Field>}
          <div className="admin-preview">{['start', 'end'].includes(previewScreen) ? <StartScreen endScreen={previewScreen === 'end'} trans={trans} mode={settings.mode} disabled onStart={() => {}} /> : previewScreen === 'intro' ? <div className="study-background"><section className="study-card text-center"><h1 className="text-2xl font-bold">{trans(previewIntroKeys.title)}</h1><p className="study-description mb-6 whitespace-pre-line">{trans(previewIntroKeys.instruction)}</p><button className="study-button" disabled>{trans('start_part_two')}</button></section></div> : <RatingPanel key={`${previewScreen}-${locale}`} trans={trans} scale={previewScreen} labels={settings.labels[locale]} sliderStep={settings.sliderStep} onChoose={value => setPreviewRating(value)} />}</div>
          {previewRating !== null && <p className="admin-message">Wybrana ocena w podglądzie: {previewRating}. Nie została zapisana.</p>}
        </section>}
        {tab === 'results' && <section className="admin-section"><h2>Wyniki badania</h2><p className="admin-note">Eksport obejmuje dotychczas zebrane dane. Kolumna study_version pozwala rozróżnić konfiguracje badania.</p>{stats && <div className="admin-stat-grid">{[['sessions', 'Sesje'], ['completed', 'Ukończone'], ['ratings', 'Oceny'], ['answers', 'Odpowiedzi kontrolne']].map(([key, label]) => <div key={key}><strong>{stats[key]}</strong><span>{label}</span></div>)}</div>}<label className="admin-check"><input type="checkbox" checked={completeOnly} onChange={e => setCompleteOnly(e.target.checked)} />Eksportuj tylko ukończone sesje</label><div className="admin-actions"><button className="admin-secondary" onClick={() => exportResults('ratings')}>Pobierz oceny CSV</button><button className="admin-secondary" onClick={() => exportResults('answers')}>Pobierz odpowiedzi CSV</button><button className="admin-small" onClick={showResults}>Odśwież statystyki</button></div></section>}
        {tab === 'access' && <section className="admin-section"><h2>Dostęp do panelu</h2><p className="admin-note">Passkey pozwala potwierdzić logowanie na urządzeniu, np. przez Touch ID, PIN albo telefon. Hasło administratora pozostaje metodą odzyskania dostępu.</p>
          {passkeyError && <p role="alert" className="admin-error">{passkeyError}</p>}
          {!passwordProtected ? <p className="admin-note">Aby dodać passkey, ustaw hasło poleceniem npm run admin:password, zrestartuj serwer i zaloguj się hasłem.</p> : <>
          {passkeyAddress && <p className="admin-note">Klucze dla adresu: <strong>{passkeyAddress}</strong></p>}
          <div className="admin-passkey-add"><Field label="Nazwa nowego klucza"><input value={passkeyName} maxLength={100} placeholder="np. MacBook lub telefon" onChange={e => setPasskeyName(e.target.value)} /></Field><button className="admin-primary" disabled={busy || !passkeySupported || !passkeyName.trim() || !!passkeyError} onClick={addPasskey}>Dodaj passkey</button></div>
          {!passkeySupported && <p className="admin-note">Otwórz panel w przeglądarce obsługującej passkey, pod adresem HTTPS lub localhost.</p>}
          {passkeys.length ? <div className="admin-passkey-list">{passkeys.map(key => <div className="admin-video-row" key={key.id}><div><strong>{key.name}</strong><small>Dodano: {key.created_at} · Ostatnie logowanie: {key.last_used_at || 'jeszcze nie użyto'}</small></div>{removingKey === key.id ? <div className="admin-actions"><button className="admin-remove" onClick={() => removePasskey(key.id)}>Potwierdź usunięcie</button><button className="admin-small" onClick={() => setRemovingKey(null)}>Anuluj</button></div> : <button className="admin-remove" onClick={() => setRemovingKey(key.id)}>Usuń klucz</button>}</div>)}</div> : !passkeyError && <p className="admin-empty mt-5">Nie dodano jeszcze passkey. Dodaj pierwszy klucz powyżej.</p>}
          <p className="admin-note">Możesz dodać kilka urządzeń. Usunięcie klucza blokuje przyszłe logowania tym kluczem; nie usuwa go z menedżera haseł urządzenia.</p>
          </>}
        </section>}
        </fieldset>
      </main>
    </div>
  </>;
}
