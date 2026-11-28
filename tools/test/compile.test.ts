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

  it('lets -D set $fn over the file\'s own value, but not a $fn given inside a call', async () => {
    const round = 'cylinder(d = 20, h = 5);';
    const at48 = await compileScad(`$fn = 48;\n${round}`);
    const overridden = await compileScad(`$fn = 12;\n${round}`, { $fn: 48 });
    expect(overridden.ok).toBe(true);
    expect(overridden.triangles).toBe(at48.triangles);
    const hexagon = await compileScad('$fn = 48;\ncylinder(d = 20, h = 5, $fn = 6);', { $fn: 32 });
    expect(hexagon.triangles).toBe(20);
  }, 30000);

  it('explains a part too detailed to build', async () => {
    const result = await compileScad('$fn = 2000; sphere(50);');
    expect(result.error).toBe('The part is too detailed to build; lower $fn or use fewer pieces.');
  }, 30000);
});
