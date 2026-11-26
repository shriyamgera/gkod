import { type ChangeEvent, useEffect, useId, useRef, useState } from 'react';
import { type ImageInput, prepareImage } from '../engine';
import './engine-ui.css';

type Props = { image: ImageInput | null; onChange: (image: ImageInput | null) => void };

export function PhotoButton({ image, onChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const id = useId();
  // the button that was pressed goes away, so focus moves to the one that takes its place
  const moveFocus = useRef(false);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (image ? removeButton : addButton).current?.focus();
  }, [image]);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // cleared so picking the same file again still fires a change
    event.target.value = '';
    if (!file) return;
    setReading(true);
    setError(null);
    setSaid('Reading the picture');
    try {
      const prepared = await prepareImage(file);
      moveFocus.current = true;
      onChange(prepared);
      setSaid('Picture added');
    } catch (problem) {
      const message = problem instanceof Error ? problem.message : 'Could not read this picture.';
      setError(message);
      setSaid(message);
    } finally {
      setReading(false);
    }
  }

  function remove() {
    moveFocus.current = true;
    onChange(null);
    setSaid('Picture removed');
  }

  return (
    <div className="photo">
      <input ref={input} type="file" accept="image/*" hidden onChange={choose} />
      {image ? (
        <div className="photo-chosen">
          <img
            src={`data:${image.mimeType};base64,${image.base64}`}
            alt="Your picture"
            width={thumbSide(image.width, image)}
            height={thumbSide(image.height, image)}
          />
          <button ref={removeButton} type="button" className="eu-quiet photo-remove" onClick={remove}>
            Remove
            <span className="visually-hidden"> the picture</span>
          </button>
        </div>
      ) : (
        <button
          ref={addButton}
          type="button"
          className="photo-add"
          onClick={reading ? undefined : () => input.current?.click()}
          aria-disabled={reading ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 1v14M1 8h14" stroke="currentColor" strokeWidth="1.8" />
          </svg>
          {reading ? 'Reading the picture…' : 'Add a photo or sketch'}
        </button>
      )}
      {error && (
        <p id={`${id}-error`} className="photo-error">
          {error}
        </p>
      )}
      <p role="status" className="visually-hidden">
        {said}
      </p>
    </div>
  );
}

const THUMB = 48;

function thumbSide(side: number, image: ImageInput): number {
  return Math.max(1, Math.round((THUMB * side) / Math.max(image.width, image.height, 1)));
}
