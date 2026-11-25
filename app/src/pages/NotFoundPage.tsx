import { links } from '../router';

export function NotFoundPage() {
  return (
    <div className="text-page">
      <h1 className="display">Page not found</h1>
      <p>
        There is nothing at this address. <a href={links.start}>Go to the start screen</a>
      </p>
    </div>
  );
}
