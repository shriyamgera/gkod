import { describe, expect, it } from 'vitest';
import { examples } from '../examples';
import { findBannedCall } from './guard';

describe('findBannedCall', () => {
  it('rejects minkowski and text calls', () => {
    expect(findBannedCall('minkowski() { cube(10); sphere(2); }')).toMatch(/minkowski/);
    expect(findBannedCall('linear_extrude(2) text ("hi");')).toMatch(/text\(\)/);
    expect(findBannedCall('union() {\n  minkowski\n  () { cube(1); }\n}')).toMatch(/minkowski/);
  });

  it('ignores the words in comments, strings and longer names', () => {
    expect(findBannedCall('// no minkowski() here\ncube(1);')).toBeNull();
    expect(findBannedCall('/* text("x") */ cube(1);')).toBeNull();
    expect(findBannedCall('echo("text(1) and \\" minkowski()"); cube(1);')).toBeNull();
    expect(findBannedCall('module context(a) { cube(a); } context(2);')).toBeNull();
    expect(findBannedCall('text_size = 4; cube(text_size);')).toBeNull();
  });

  it('still sees a call that follows a string or comment', () => {
    expect(findBannedCall('echo("// not a comment"); minkowski() { cube(1); }')).toMatch(/minkowski/);
    expect(findBannedCall('cube(1); /* note */ text("a");')).toMatch(/text\(\)/);
  });

  it('accepts the example parts', () => {
    for (const example of examples) expect(findBannedCall(example.source)).toBeNull();
  });
});
