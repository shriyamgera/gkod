import { describe, expect, it } from 'vitest';
import texts from '../../public/third-party-licenses.txt?raw';
import app from '../../package.json';

describe('third-party licence texts', () => {
  it('has a full licence text for every package the site depends on', () => {
    for (const name of Object.keys(app.dependencies)) {
      expect(texts).toMatch(new RegExp(`^${name.replace('/', '\\/')} \\d`, 'm'));
    }
  });

  it('has the OpenSCAD and Manifold licences that ship inside the compiler', () => {
    expect(texts).toContain('As a special exception, you have permission to link this program');
    expect(texts).toContain('GNU GENERAL PUBLIC LICENSE\n\t\t       Version 2, June 1991');
    expect(texts).toContain('Apache License\n                           Version 2.0, January 2004');
  });

  it('has the font licences', () => {
    expect(texts).toMatch(/^Archivo font .*\nOFL-1\.1\n/m);
    expect(texts).toMatch(/^IBM Plex Mono font .*\nOFL-1\.1\n/m);
    expect(texts).toContain('Copyright 2020 The Archivo Project Authors');
    expect(texts).toContain('Copyright 2017 IBM Corp.');
  });
});
