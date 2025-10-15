export default function ProgressBar({ value }) {
  return (
    <div className="bg-gray-700 rounded-full h-4 overflow-hidden shadow-lg">
      <div
        className="bg-blue-500 h-full transition-all duration-300"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}
