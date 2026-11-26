import { type ReactNode, useId, useState } from 'react';

type Props = { title: string; defaultOpen?: boolean; children: ReactNode };

export function Disclosure({ title, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="disclosure">
      <h2>
        <button
          type="button"
          className="disclosure-button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          {title}
          <span aria-hidden="true">{open ? '−' : '+'}</span>
        </button>
      </h2>
      {/* kept in the page when closed, so typed values and scroll position survive */}
      <div id={id} className="disclosure-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
