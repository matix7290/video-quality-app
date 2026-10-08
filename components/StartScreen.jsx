export default function StartScreen({
  endScreen,
  trans,
  isFullscreen,
  onStart,
  children,
  disabled,
  error,
  mode = "both",
}) {
  return (
    <main className="study-background study-surface">
      <section className="study-card study-welcome-card">
        <header className="study-welcome-header">
          <span className="study-mark" aria-hidden="true">VQ</span>
          <h1>{trans(endScreen ? "thanks" : "welcome")}</h1>
        </header>
        {endScreen ? <p className="study-description whitespace-pre-line">{trans("end_info")}</p> : <>
          <div className="study-description whitespace-pre-line">
            {["instruction", "instruction_loadings", "instruction_scoring", ...(mode === "both" ? ["two_parts_instruction"] : [])].map(key => <p key={key}>{trans(key)}</p>)}
          </div>
          <button onClick={onStart} className="study-button study-start-button" disabled={isFullscreen || disabled}>
            {trans("start")}
          </button>
          {error && <p role="alert" className="study-error">{error}</p>}
          {children}
        </>}
      </section>
    </main>
  );
}
