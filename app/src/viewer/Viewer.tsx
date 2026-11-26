import {
  Component,
  type KeyboardEvent,
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useId,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { GRID_MM } from './grid';
import type { ViewerMark } from './mark';
import type { ViewHandle } from './Scene';
import { describeMesh, type Mesh, parseStl } from './stl';
import './viewer.css';

const loadView3D = () => import('./View3D');
const View3D = lazy(loadView3D);

const TURN_STEP = Math.PI / 24;
const ZOOM_STEP = 0.85;

type Loaded = { mesh: Mesh | null; error: string | null };

type Props = {
  stl: ArrayBuffer | null;
  busy?: boolean;
  // shown in place of the model while there is none, e.g. while the compiler loads
  note?: string;
  // what the model on screen is, shown in a corner as "Live · <live>"
  live?: string;
  // shown in the same corner while a new model is being made
  busyText?: string;
  // faces to pick out on the part, with a label at one point, e.g. where it would sag
  mark?: ViewerMark | null;
};

export function Viewer({ stl, busy = false, note, live, busyText = 'Updating', mark }: Props) {
  const { mesh, error } = useMemo(() => load(stl), [stl]);
  const view = useRef<ViewHandle | null>(null);
  const markLabel = useRef<HTMLDivElement | null>(null);
  const summaryId = useId();
  const spin = !useReducedMotion();

  // fetch three.js while the first model is still being made
  useEffect(() => {
    void loadView3D();
  }, []);

  function onKeyDown(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const act = keyAction(event.key);
    if (!act || !view.current) return;
    event.preventDefault();
    act(view.current);
  }

  return (
    <div className="viewer">
      <div className="viewer-stage">
        <div
          className="viewer-canvas"
          tabIndex={0}
          role="application"
          aria-label="3D view of the part. Arrow keys turn it, plus and minus zoom, zero resets the view."
          aria-describedby={summaryId}
          aria-busy={busy}
          onKeyDown={onKeyDown}
        >
          {mesh && (
            <ViewFailure>
              <Suspense fallback={<p className="viewer-note">Loading the 3D view</p>}>
                <View3D mesh={mesh} spin={spin} handle={view} mark={mark} markLabel={markLabel} />
              </Suspense>
            </ViewFailure>
          )}
        </div>

        {/* placed by the 3D view, which also hides it while the point is out of sight */}
        {mesh && mark?.at && (
          <div className="viewer-mark" ref={markLabel} aria-hidden="true">
            <span className="viewer-mark-dot" />
            <span className="viewer-mark-line" />
            <span className="viewer-mark-text">{mark.label}</span>
          </div>
        )}

        {!mesh && (
          <p className="viewer-note" role={error ? 'alert' : undefined}>
            {error ? `This model could not be shown. ${error}` : (note ?? (busy ? 'Making the model' : 'No model yet'))}
          </p>
        )}
        {mesh && busy && (
          <p className="viewer-busy">
            <span className="viewer-busy-mark viewer-busy-spin" aria-hidden="true" />
            {busyText}
          </p>
        )}
        {mesh && !busy && live && (
          <p className="viewer-busy viewer-live">
            <span className="viewer-busy-mark" aria-hidden="true" />
            <span>
              <strong>Live</strong> · {live}
            </span>
          </p>
        )}
        {mesh && (
          <>
            <p className="viewer-hint">
              Drag to turn it around
              <span className="viewer-keys">. Arrow keys turn, + and - zoom, 0 resets.</span>
            </p>
            <button type="button" className="viewer-reset" onClick={() => view.current?.reset()}>
              Reset view
            </button>
          </>
        )}
      </div>

      <div className="viewer-summary">
        <p id={summaryId} className="mono">
          {mesh ? summary(mesh, mark) : error ? 'No model to measure' : 'No model yet'}
        </p>
        {mesh && <p className="mono muted">Grid squares {GRID_MM} mm</p>}
      </div>
    </div>
  );
}

// WebGL can be missing or switched off, and the three.js file can fail to download. Either way the rest
// of the page (sizes, download) still works, so only the view is replaced.
class ViewFailure extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <p className="viewer-note" role="alert">
        This browser could not draw the 3D view. The sizes and the download still work.
      </p>
    );
  }
}

function summary(mesh: Mesh, mark: ViewerMark | null | undefined): string {
  return mark ? `${describeMesh(mesh)}. ${mark.description}` : describeMesh(mesh);
}

function load(stl: ArrayBuffer | null): Loaded {
  if (!stl) return { mesh: null, error: null };
  try {
    const mesh = parseStl(stl);
    if (mesh.triangles === 0) return { mesh: null, error: 'It has no shape.' };
    return { mesh, error: null };
  } catch (cause) {
    return { mesh: null, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

const reducedMotion = '(prefers-reduced-motion: reduce)';

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(reducedMotion);
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    },
    () => window.matchMedia(reducedMotion).matches,
  );
}

function keyAction(key: string): ((view: ViewHandle) => void) | null {
  switch (key) {
    case 'ArrowLeft':
      return (view) => view.turn(-TURN_STEP, 0);
    case 'ArrowRight':
      return (view) => view.turn(TURN_STEP, 0);
    case 'ArrowUp':
      return (view) => view.turn(0, -TURN_STEP);
    case 'ArrowDown':
      return (view) => view.turn(0, TURN_STEP);
    case '+':
    case '=':
      return (view) => view.zoom(ZOOM_STEP);
    case '-':
    case '_':
      return (view) => view.zoom(1 / ZOOM_STEP);
    case '0':
    case 'Home':
      return (view) => view.reset();
    default:
      return null;
  }
}
