import { describe, expect, it } from 'vitest';
import { compileScad } from '../src/compile.ts';

// These failures only show with the real compiler, run in a Node worker as gkod and the MCP server run it.
describe('compileScad', () => {
  it('compiles a part to a binary STL', async () => {
    const result = await compileScad('cube([20, 10, 5]);');
    expect(result.ok).toBe(true);
    expect(result.triangles).toBe(12);
  }, 30000);

  const recursions = [
    'function g(n) = 1 + g(n + 1); x = g(0); cube(1);',
    'function g(n) = n == 0 ? 0 : 1 + g(n - 1); x = g(100000); cube(1);',
    'module m() { m(); } m();',
    'module m(n) { if (n > 0) { cube(1); m(n - 1); } } m(5000);',
  ];
  for (const source of recursions) {
    it(`explains the recursion in: ${source}`, async () => {
      const result = await compileScad(source);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('The code ran out of room, most likely from recursion that never ends or goes too deep.');
    }, 30000);
  }

  it('explains a part too detailed to build', async () => {
    const result = await compileScad('$fn = 2000; sphere(50);');
    expect(result.error).toBe('The part is too detailed to build; lower $fn or use fewer pieces.');
  }, 30000);
});
