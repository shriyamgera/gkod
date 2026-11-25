import { links } from '../router';

export function Footer() {
  return (
    <footer className="site-footer">
      <span>GKod is free software. Licence: GPL-3.0-or-later.</span>
      <a href={links.notices}>Third-party notices</a>
    </footer>
  );
}
