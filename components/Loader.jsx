export default function Loader({ percent = null, label = "Ładowanie…" }) {
  const isIndeterminate = percent == null || Number.isNaN(percent);
  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-gray-200">{label}</span>
        {!isIndeterminate && (
          <span className="text-sm text-gray-300">{Math.round(percent)}%</span>
        )}
      </div>
      <div className="w-full h-2 bg-gray-700 rounded">
        {isIndeterminate ? (
          <div className="h-2 w-1/3 bg-gray-200 rounded animate-pulse" />
        ) : (
          <div
            className="h-2 bg-gray-200 rounded transition-all"
            style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
          />
        )}
      </div>
    </div>
  );
}
