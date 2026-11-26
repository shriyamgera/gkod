import type { FormEvent, ReactNode, Ref } from 'react';

export const CHANGE_ID = 'change';

const ideas = ['10 mm wider', 'Thicker walls', 'Rounder corners'];

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  busy: boolean;
  inputRef?: Ref<HTMLInputElement>;
  // the status line, key panel or problem box, shown under the field
  children?: ReactNode;
};

// "Change anything": a typed change to the part on screen. Enter or the Change button sends it.
export function ChangeBox({ value, onChange, onSubmit, busy, inputRef, children }: Props) {
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy) onSubmit();
  }

  function pickIdea(idea: string) {
    onChange(idea);
    const field = document.getElementById(CHANGE_ID) as HTMLInputElement | null;
    field?.focus();
    requestAnimationFrame(() => field?.setSelectionRange(idea.length, idea.length));
  }

  return (
    <div className="change-box">
      <form className="change-form" onSubmit={submit}>
        <label htmlFor={CHANGE_ID} className="visually-hidden">
          Change anything
        </label>
        <input
          ref={inputRef}
          id={CHANGE_ID}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="e.g. make it 10 mm wider"
          autoComplete="off"
          enterKeyHint="send"
        />
        <button type="submit" className="change-button" aria-disabled={busy ? true : undefined}>
          {busy ? 'Changing…' : 'Change'}
        </button>
      </form>
      {children}
      <div className="chips change-ideas" role="group" aria-label="Ideas to try">
        <span className="muted" aria-hidden="true">
          Try
        </span>
        {ideas.map((idea) => (
          <button key={idea} type="button" className="chip" onClick={() => pickIdea(idea)}>
            {idea}
          </button>
        ))}
      </div>
    </div>
  );
}
