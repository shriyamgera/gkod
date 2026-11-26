import { useId } from 'react';
import type { ModelChoice } from '../engine';
import { modelName } from './names';
import type { SavedModel } from './store';

type Props = {
  model: SavedModel;
  models: ModelChoice[];
  onSelect: (v: number) => void;
  onUndo: () => void;
  onRedo: () => void;
};

// Every version, newest first. Choosing one shows it; undo and redo step one version back or forward.
export function Changes({ model, models, onSelect, onUndo, onRedo }: Props) {
  const id = useId();
  const canUndo = model.current > 1;
  const canRedo = model.current < model.versions.length;
  const newestFirst = [...model.versions].reverse();

  return (
    <section className="changes" aria-labelledby={id}>
      <div className="changes-head">
        <h2 id={id}>Changes</h2>
        <div className="changes-steps">
          <button
            type="button"
            className="button-quiet"
            aria-disabled={!canUndo}
            aria-keyshortcuts="Control+Z Meta+Z"
            onClick={canUndo ? onUndo : undefined}
          >
            Undo
          </button>
          <button
            type="button"
            className="button-quiet"
            aria-disabled={!canRedo}
            aria-keyshortcuts="Shift+Control+Z Shift+Meta+Z"
            onClick={canRedo ? onRedo : undefined}
          >
            Redo
          </button>
        </div>
      </div>
      <ol className="changes-list">
        {newestFirst.map((version) => {
          const shown = version.v === model.current;
          const by = modelName(version.model, models);
          return (
            <li key={version.v}>
              <button
                type="button"
                className="change-item"
                aria-current={shown ? 'true' : undefined}
                onClick={() => onSelect(version.v)}
              >
                <span className="mono muted" aria-hidden="true">
                  v{version.v}
                </span>
                <span className="change-text">
                  <span className="visually-hidden">Version {version.v}: </span>
                  <span className="change-label">{version.label}</span>
                  {(by || shown) && (
                    <span className="change-by muted">
                      {by}
                      {by && shown && ' · '}
                      {shown && <strong>Shown</strong>}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
