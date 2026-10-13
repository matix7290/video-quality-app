export default function AdminLanguageSwitcher({ locale, onChange, label }) {
  return <label className="admin-panel-language"><span>{label}</span>
    <select value={locale} onChange={event => onChange(event.target.value)}>
      <option value="pl" lang="pl">Polski</option>
      <option value="en" lang="en">English</option>
    </select>
  </label>;
}
