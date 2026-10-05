/** 0.1 秒刻みなどの数値入力。キーボード表示時も確定できるよう type=number + inputMode=decimal。 */
export function NumberField({ id, label, value, min, max, step, unit, onChange, disabled }: { id: string; label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <label className="field" htmlFor={id}>
      <span className="field__label">{label}</span>
      <span className="field__row">
        <input
          id={id}
          className="input input--num"
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={Number.isFinite(value) ? value : ''}
          disabled={disabled}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
          }}
        />
        {unit ? <span className="field__unit">{unit}</span> : null}
      </span>
    </label>
  );
}
