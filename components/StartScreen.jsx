export default function StartScreen({
  endScreen,
  trans,
  autoFullscreen,
  setAutoFullscreen,
  isFullscreen,
  onStart,
  children,
}) {
  return (
    <div className="flex flex-col items-center justify-center h-screen m-0 p-0 bg-gray-900 bg-opacity-75 text-white">
      <div className="backdrop-blur-md bg-white/30 p-8 rounded-xl shadow-lg text-center">
        {endScreen ? (
          <>
            <h1 className="text-4xl font-extrabold text-white">
              {trans("thanks")}
            </h1>
            <h2 className="text-lg font-medium text-white mt-2">
              {trans("end_info")}
            </h2>
          </>
        ) : (
          <>
            <h1 className="text-4xl font-extrabold text-white">
              {trans("welcome")}
            </h1>
            <h2 className="text-lg font-medium text-white mt-2">
              {trans("instruction")}
              <br />
              {trans("instruction_loadings")}
              <br />
              {trans("instruction_scoring")}
            </h2>

            <label className="flex items-center justify-center mt-4 bg-white/30 p-2 rounded-lg shadow-md cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoFullscreen}
                onChange={() =>
                  !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) &&
                  setAutoFullscreen(!autoFullscreen)
                }
                className="hidden"
              />
              <span
                className={`w-10 h-5 flex items-center rounded-full p-1 transition ${
                  autoFullscreen ? "bg-green-500" : "bg-gray-400"
                }`}
              >
                <span
                  className={`bg-white w-4 h-4 rounded-full shadow-md transform ${
                    autoFullscreen ? "translate-x-5" : ""
                  }`}
                ></span>
              </span>
              <span className="ml-3 text-white font-semibold">
                {trans("auto_fullscreen")}
              </span>
            </label>

            <button
              onClick={onStart}
              className="mt-6 px-8 py-3 bg-white/20 text-white font-bold text-lg rounded-lg shadow-lg hover:bg-white/30 transition-all"
              disabled={isFullscreen}
            >
              {trans("start")}
            </button>

            {children /* ScreentestModal */}
          </>
        )}
      </div>
    </div>
  );
}
