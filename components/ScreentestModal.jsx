export default function ScreentestModal({ open, onClose, title, saving, error, savingText }) {
  if (!open) return null;
  return (
    <div className="study-surface study-modal-overlay fixed inset-0 z-50 flex items-center justify-center">
      <div className="study-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="study-modal-header">
          <h3 className="text-white font-semibold">{title}</h3>
          <button
            onClick={onClose}
            disabled={saving}
            className="study-modal-close"
            aria-label="Zamknij"
          >
            ✕
          </button>
        </div>
        {saving && <p role="status" className="study-description px-4">{savingText}</p>}
        {error && <p role="alert" className="study-error px-4">{error}</p>}
        <iframe
          src="/screentest/index.html"
          title="Screen test"
        />
      </div>
    </div>
  );
}
