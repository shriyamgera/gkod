import { type KeyboardEvent, type Ref, useId } from 'react';
import type { ImageInput } from '../engine';
import { PhotoButton } from './PhotoButton';
import { isSubmitKey } from './rules';
import './engine-ui.css';

type Props = {
  value: string;
  onChange: (value: string) => void;
  image: ImageInput | null;
  onImage: (image: ImageInput | null) => void;
  onReading?: (reading: boolean) => void;
  busy: boolean;
  onSubmit: () => void;
  textareaRef?: Ref<HTMLTextAreaElement>;
  buttonRef?: Ref<HTMLButtonElement>;
  describedBy?: string;
};

export const PROMPT_ID = 'prompt';

export function PromptBox({
  value,
  onChange,
  image,
  onImage,
  onReading,
  busy,
  onSubmit,
  textareaRef,
  buttonRef,
  describedBy,
}: Props) {
  const id = useId();

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!isSubmitKey({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing })) return;
    event.preventDefault();
    if (!busy) onSubmit();
  }

  return (
    <div className="prompt-box">
      <label htmlFor={PROMPT_ID} className="visually-hidden">
        Describe the part you want to print
      </label>
      <textarea
        ref={textareaRef}
        id={PROMPT_ID}
        rows={3}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="e.g. a phone stand for a 9 mm thick phone, tilted back a little, with a slot for the cable"
        aria-describedby={[`${id}-keys`, describedBy].filter(Boolean).join(' ')}
      />
      <p id={`${id}-keys`} className="visually-hidden">
        Enter makes the part. Shift and Enter adds a new line.
      </p>
      <div className="prompt-bar">
        <PhotoButton image={image} onChange={onImage} onReading={onReading} />
        <button
          ref={buttonRef}
          type="button"
          className="eu-main make-button"
          aria-disabled={busy ? true : undefined}
          onClick={busy ? undefined : onSubmit}
        >
          {busy ? 'Making…' : 'Make it'}
          {!busy && (
            <svg width="20" height="14" viewBox="0 0 20 14" aria-hidden="true">
              <path d="M0 7h18M12 1l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
