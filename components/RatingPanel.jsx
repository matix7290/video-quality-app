import { useEffect, useRef, useState } from "react";

export default function RatingPanel({ trans, onChoose, disabled }) {
  const panelRef = useRef(null);
  const [scaleFactor, setScaleFactor] = useState(1);

  useEffect(() => {
    const recompute = () => {
      if (!panelRef.current) return;
      const panelHeight = panelRef.current.offsetHeight;
      const windowHeight =
        window.visualViewport?.height || document.documentElement.clientHeight;
      setScaleFactor(
        panelHeight > windowHeight ? windowHeight / panelHeight : 1
      );
    };
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, []);

  const labels = [
    trans("excellent"),
    trans("good"),
    trans("average"),
    trans("poor"),
    trans("bad"),
  ];

  return (
    <div
      ref={panelRef}
      className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 backdrop-blur-md bg-white/30 p-6 rounded-xl shadow-lg text-center w-3/4 max-w-2xl"
      style={{ transform: `translate(-50%, -50%) scale(${scaleFactor})` }}
    >
      <p className="text-xl font-semibold text-white">
        {trans("rate_quality")}
      </p>
      <div className="mt-2 flex flex-col space-y-2">
        {labels.map((label, index) => (
          <button
            key={index}
            onClick={() => onChoose(5 - index)}
            className="px-4 py-3 rounded-lg text-white font-semibold transition-all bg-white/20 hover:bg-white/30 shadow-md"
            disabled={disabled}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
