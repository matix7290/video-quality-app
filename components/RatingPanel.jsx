import { useState } from "react";

export default function RatingPanel({ trans, onChoose, disabled, scale = 'standard', error, saving, onRetry, labels: customLabels, sliderStep = 0.01 }) {
  const [value, setValue] = useState(3);
  const [touched, setTouched] = useState(false);

  const labels = customLabels ? [...customLabels].reverse() : [
    trans("excellent"),
    trans("good"),
    trans("average"),
    trans("poor"),
    trans("bad"),
  ];

  return (
    <section className="study-card study-rating-card">
      <h2 className="study-rating-heading">{trans("rate_quality")}</h2>
      {scale === 'slider' ? (
        <div className="mt-6">
          <p className="study-description mb-6">{trans('slider_hint')}</p>
          <div className="slider-scale">
            <input aria-label={trans('rate_quality')} aria-valuetext={String(value)}
              type="range" min="1" max="5" step={sliderStep} value={value}
              disabled={disabled}
              onPointerDown={() => setTouched(true)}
              onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) setTouched(true); }}
              onChange={e => { setValue(Number(e.target.value)); setTouched(true); }} />
            <div className="slider-ticks" aria-hidden="true">
              {[1, 2, 3, 4, 5].map(number => <span key={number} style={{ left: `${(number - 1) * 25}%` }} />)}
            </div>
            <div className="slider-labels" aria-hidden="true">
              {[...labels].reverse().map((label, i) => (
                <span key={i} style={{ left: `${i * 25}%` }}><strong>{i + 1}</strong><br />{label}</span>
              ))}
            </div>
          </div>
          <output className="study-rating-output" aria-live="polite">{touched ? value.toFixed(2) : trans('choose_value')}</output>
          <button className="study-button" disabled={disabled || !touched} onClick={() => onChoose(value)}>
            {trans(saving ? 'saving' : 'submit')}
          </button>
        </div>
      ) : <div className="study-rating-options">
        {labels.map((label, index) => (
          <button
            key={index}
            onClick={() => onChoose(5 - index)}
            className="study-rating-option"
            disabled={disabled}
          >
            <span className="study-rating-value" aria-hidden="true">{5 - index}</span><span>{label}</span>
          </button>
        ))}
      </div>}
      {error && <div className="mt-4"><p role="alert" className="study-error">{error}</p>
        <button className="study-button mt-3" disabled={saving} onClick={onRetry}>{trans('retry')}</button></div>}
    </section>
  );
}
