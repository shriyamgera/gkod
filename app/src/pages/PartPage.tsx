import { findExample } from '../examples';
import { links } from '../router';
import { NotFoundPage } from './NotFoundPage';

export function PartPage({ exampleId }: { exampleId: string }) {
  const example = findExample(exampleId);
  if (!example) return <NotFoundPage />;

  return (
    <div className="part">
      <div className="part-head">
        <a className="back-link" href={links.start}>
          ← All examples
        </a>
        <div className="part-title">
          <h1 className="display">{example.name}</h1>
          <span className="mono muted">Example part</span>
        </div>
      </div>

      <div className="part-columns">
        <section className="part-view" aria-label="Your model">
          <div className="part-view-stage">
            <p className="muted">The 3D view is not connected yet.</p>
          </div>
        </section>

        <aside className="part-side" aria-label="Sizes and code">
          <section className="part-panel" aria-labelledby="sizes-heading">
            <h2 id="sizes-heading">Sizes</h2>
            <p className="muted">Size sliders are not connected yet.</p>
          </section>
          <section className="part-panel" aria-labelledby="code-heading">
            <h2 id="code-heading">Code</h2>
            <pre className="code" tabIndex={0} aria-label={`OpenSCAD code for ${example.name}`}>
              {example.source}
            </pre>
          </section>
        </aside>
      </div>
    </div>
  );
}
