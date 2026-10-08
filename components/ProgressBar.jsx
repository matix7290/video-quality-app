export default function ProgressBar({ value }) {
  return (
    <div className="rounded-full h-2 overflow-hidden border border-[#3a4b63] bg-[#182235]">
      <div
        className="bg-[#2563eb] h-full transition-all duration-300"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}
