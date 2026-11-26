import { readFile } from 'node:fs/promises';
import { checkGcode, DEFAULT_ALLOWED, PLA_LIMITS } from '@gkod/checks';
import { expect, test } from '@playwright/test';
import { DEFAULT_PRINTER_ID, findPrinter } from '../app/src/slicer/printers.ts';

test('slices the test cube for the Kobra 2 Neo and the G-code passes the safety check', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('#/part/test_cube');
  await expect(page.getByRole('heading', { name: 'Ready to print' })).toBeVisible({ timeout: 60_000 });

  const print = page.getByRole('region', { name: 'Print', exact: true });
  await print.getByLabel('Printer').selectOption({ label: 'Anycubic Kobra 2 Neo' });
  await expect(print.getByText('220 x 220 x 250 mm bed, PLA only')).toBeVisible();
  await expect(print.getByLabel('Normal')).toBeChecked();
  await print.getByLabel('Infill').selectOption('15');
  await expect(print.getByLabel('Print with supports')).not.toBeChecked();

  await print.getByRole('button', { name: 'Slice for my printer' }).click();
  const download = print.getByRole('button', { name: 'Download G-code' });
  await expect(download).toBeVisible({ timeout: 90_000 });
  await expect(print.getByText('(estimate, not exact)')).toBeVisible();
  await expect(print.getByText(/m of filament$/)).toBeVisible();
  await expect(print.getByText(/\bgrams?\b|\d g\b/)).toHaveCount(0);

  const [file] = await Promise.all([page.waitForEvent('download'), download.click()]);
  expect(file.suggestedFilename()).toBe('test_cube_kobra2neo.gcode');
  const gcode = await readFile(await file.path(), 'utf8');

  const printer = findPrinter(DEFAULT_PRINTER_ID)!;
  expect(printer.name).toBe('Anycubic Kobra 2 Neo');
  const report = checkGcode(gcode, { bed: printer.bed, ...PLA_LIMITS, allowed: DEFAULT_ALLOWED });
  expect(report.problems).toEqual([]);
  expect(report.ok).toBe(true);
  const { maxX, maxY, maxZ, minZ, nozzle, bed, fanOnLayer, extruderMode } = report.stats;
  expect(maxX).toBeLessThanOrEqual(220);
  expect(maxY).toBeLessThanOrEqual(220);
  expect(minZ).toBeGreaterThan(0);
  // 20 mm high, plus the lift at the end
  expect(maxZ).toBeGreaterThanOrEqual(20);
  expect(maxZ).toBeLessThanOrEqual(250);
  expect(nozzle.filter((t) => t > 0)).toEqual([205]);
  expect(bed.filter((t) => t > 0)).toEqual([60]);
  expect(fanOnLayer).toBe(2);
  expect(extruderMode).toBe('relative');
  expect(errors).toEqual([]);
});
