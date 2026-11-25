import { describe, expect, it } from 'vitest';
import { links, parseRoute } from './router';

describe('parseRoute', () => {
  it('reads the start screen from an empty or root hash', () => {
    expect(parseRoute('')).toEqual({ page: 'start' });
    expect(parseRoute('#')).toEqual({ page: 'start' });
    expect(parseRoute('#/')).toEqual({ page: 'start' });
  });

  it('reads a part id', () => {
    expect(parseRoute('#/part/phone_stand')).toEqual({ page: 'part', exampleId: 'phone_stand' });
    expect(parseRoute('#/part/phone_stand/')).toEqual({ page: 'part', exampleId: 'phone_stand' });
  });

  it('reads the notices page', () => {
    expect(parseRoute('#/notices')).toEqual({ page: 'notices' });
  });

  it('gives notFound for anything else', () => {
    expect(parseRoute('#/part')).toEqual({ page: 'notFound' });
    expect(parseRoute('#/part/a/b')).toEqual({ page: 'notFound' });
    expect(parseRoute('#/settings')).toEqual({ page: 'notFound' });
    expect(parseRoute('#/part/%E0%A4%A')).toEqual({ page: 'notFound' });
  });

  it('round-trips ids through links.part', () => {
    expect(parseRoute(links.part('wall hook'))).toEqual({ page: 'part', exampleId: 'wall hook' });
  });
});
