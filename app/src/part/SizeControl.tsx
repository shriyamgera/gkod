import { type ChangeEvent, type KeyboardEvent, useId, useState } from 'react';
import type { Param } from '../scad/types';
import { describeParam, fitToParam, formatValue } from './sizes';

type Props = { param: Param; value: number; onChange: (value: number) => void };

// A slider and a number box for one size. Both edit the same value.
export function SizeControl({ param, value, onChange }: Props) {
  const id = useId();
  const info = describeParam(param);
  // what is typed in the number box, kept apart so a half-typed number is not clamped mid-way
  const [draft, setDraft] = useState<string | null>(null);
  const helpId = info.help ? `${id}help` : undefined;

  function set(next: number) {
    const fitted = fitToParam(next, param);
    if (fitted !== value) onChange(fitted);
  }

  function onType(event: ChangeEvent<HTMLInputElement>) {
    const text = event.target.value;
    setDraft(text);
    const typed = Number(text);
    if (text.trim() !== '' && typed >= param.min && typed <= param.max) set(typed);
  }

  function commit() {
    if (draft === null) return;
    const typed = Number(draft);
    if (draft.trim() !== '' && Number.isFinite(typed)) set(typed);
    setDraft(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') commit();
    if (event.key === 'Escape') setDraft(null);
  }

  return (
    <div className="size">
      <div className="size-row">
        <div className="size-name">
          <label htmlFor={`${id}range`}>{info.label}</label>
          {info.help && (
            <p id={helpId} className="size-help">
              {info.help}
            </p>
          )}
        </div>
        <span className="size-box">
          <input
            type="number"
            inputMode="decimal"
            min={param.min}
            max={param.max}
            step={param.step}
            value={draft ?? formatValue(value)}
            aria-label={`${info.label} in ${info.unitName}`}
            aria-describedby={helpId}
            onChange={onType}
            onBlur={commit}
            onKeyDown={onKeyDown}
          />
          <span className="size-unit" aria-hidden="true">
            {info.unit}
          </span>
        </span>
      </div>
      <input
        id={`${id}range`}
        className="size-range"
        type="range"
        min={param.min}
        max={param.max}
        step={param.step}
        value={value}
        aria-valuetext={`${formatValue(value)} ${info.unitName}`}
        aria-describedby={helpId}
        onChange={(event) => set(Number(event.target.value))}
      />
    </div>
  );
}
