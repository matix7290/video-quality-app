export default function ScreentestModal({ open, onClose, title }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-gray-900 rounded-xl overflow-hidden shadow-2xl w-[90vw] h-[90vh] relative">
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
          <h3 className="text-white font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white"
            aria-label="Zamknij"
          >
            ✕
          </button>
        </div>
        <iframe
          src="/screentest/index.html"
          className="w-full h-[calc(90vh-44px)]"
          title="Screen test"
        />
      </div>
    </div>
  );
}
