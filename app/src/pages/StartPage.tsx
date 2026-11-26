import { countSizes, examples } from '../examples';
import { links } from '../router';

export function StartPage() {
  return (
    <div className="start">
      <h1 className="display">What do you want to print?</h1>
      <p className="start-note">
        Typing a request to make a new part comes next. For now, open an example part and change its sizes.
      </p>

      <ul className="example-list" aria-label="Example parts">
        {examples.map((example) => (
          <li key={example.id}>
            <a href={links.part(example.id)}>
              <span className="example-name">{example.name}</span>
              <span className="example-meta mono">
                {countSizes(example.source)} sizes
                <svg width="20" height="14" viewBox="0 0 20 14" aria-hidden="true">
                  <path d="M0 7h18M12 1l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" />
                </svg>
              </span>
            </a>
          </li>
        ))}
      </ul>

      <ol className="steps" aria-label="How a part is made">
        <li>
          <span className="mono muted">1</span>
          <strong>A part is code</strong>
          <span className="step-text">Each part is a short OpenSCAD program, not a fixed mesh.</span>
        </li>
        <li>
          <span className="mono muted">2</span>
          <strong>Sizes have names</strong>
          <span className="step-text">Width, angle, wall thickness. Change one and nothing else moves.</span>
        </li>
        <li>
          <span className="mono muted">3</span>
          <strong>It runs in your browser</strong>
          <span className="step-text">The code is compiled to a 3D shape on your device.</span>
        </li>
      </ol>
    </div>
  );
}
