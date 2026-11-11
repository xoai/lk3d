// The playground (playground/): a scene typed is drawn and checked as `lk3d check` does, each problem shown where it is
// in the text; a link made by Share brings the same scene back. (Chromium: the page is the same everywhere.)
import { test, expect } from '@playwright/test';

test.skip(({ browserName }) => browserName !== 'chromium', 'the page is the same in every browser');

const edit = (page, change) =>
  page.locator('#editor').evaluate((editor, [from, to]) => {
    editor.value = editor.value.replace(from, to);
    editor.dispatchEvent(new Event('input'));
  }, change);
const checks = (page) => page.locator('#problems').innerText();

test('a scene is drawn and checked as it is typed; a problem is shown where it is; a shared link brings it back', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/playground/index.html');
  await expect(page.locator('#problems')).toContainText('No problems');
  await expect(page.locator('#figure canvas')).toHaveCount(1);
  await expect(page.locator('#summary')).toHaveText('2 parts, 480 triangles');
  // a misspelt field: named with its path and line, and chosen in the text when clicked
  await edit(page, ['"color": "#9aa3ad"', '"colour": "#9aa3ad"']);
  await expect(page.locator('#problems')).toContainText('parts[0].colour');
  expect(await checks(page)).toContain('is not a field here (color?)');
  await page.locator('#problems li').first().click();
  expect(await page.locator('#editor').evaluate((e) => e.value.slice(e.selectionStart, e.selectionEnd))).toBe(
    '"#9aa3ad"',
  );
  // not JSON at all: where it breaks
  await edit(page, ['"colour"', '"color"']);
  await edit(page, ['"title"', 'title']);
  await expect(page.locator('#problems')).toContainText('JSON · line 2');
  await edit(page, ['title', '"title"']);
  await expect(page.locator('#problems')).toContainText('No problems');
  // a geometry problem: a part moved into the air (lk3d/lint, as lk3d check)
  await edit(page, ['"explode": [0.6, 0, 0]', '"explode": [0.6, 0, 0], "at": [0, 3, 0]']);
  await expect(page.locator('#problems')).toContainText('geometry');
  await edit(page, [', "at": [0, 3, 0]', '']);
  // an edit draws again, keeping the reader's view
  await page.evaluate(() => document.querySelector('#figure').lk3d.set({ camera: { yaw: 50, pitch: 10 } }));
  await edit(page, ['"Nut"', '"Hex nut"']);
  await expect(page.locator('#problems')).toContainText('No problems');
  await expect.poll(() => page.evaluate(() => document.querySelector('#figure').lk3d.parts[1].name)).toBe('Hex nut');
  expect(await page.evaluate(() => Math.round(document.querySelector('#figure').lk3d.camera().yaw))).toBe(50);
  // shared: the link holds the scene; opened, the same text and figure
  const text = await page.locator('#editor').inputValue();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('#share').click();
  await expect(page).toHaveURL(/#scene=/);
  const link = page.url(),
    other = await page.context().newPage();
  await other.goto(link);
  await expect(other.locator('#problems')).toContainText('No problems');
  expect(await other.locator('#editor').inputValue()).toBe(text);
  // an example: the lens bench, with its dimensions drawn
  await page.selectOption('#example', 'lens');
  await expect(page.locator('#summary')).toHaveText('8 parts, 2,392 triangles');
  await expect.poll(() => page.locator('.lk3d-dimtext').allInnerTexts()).toEqual(['45 cm', '15 cm']);
  expect(errors).toEqual([]);
});
