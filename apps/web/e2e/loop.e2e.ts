import { expect, type Page, test } from '@playwright/test';

// Главная петля игры глазами игрока: вход -> прогноз -> итог -> баланс -> история -> проверка результата.
// Котировки настоящие, поэтому направление итога заранее неизвестно: проверяется согласованность чисел.

function coins(text: string): number {
  return Number(text.replace(/[^\d-]/g, ''));
}

async function balance(page: Page): Promise<number> {
  return coins(await page.getByLabel('Баланс').innerText());
}

test('гость делает прогноз, видит итог, баланс сходится с историей', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  // ник предложен заранее: можно сразу играть
  await expect(page.getByLabel('Ваш игровой ник')).not.toHaveValue('', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Играть' }).click();
  await expect(page.getByLabel('Баланс')).toContainText('10');
  expect(await balance(page)).toBe(10_000);

  // кнопки доступны, когда соединение сверено и цена живая
  const up = page.getByRole('button', { name: /^Выше/ });
  await expect(up).toBeEnabled({ timeout: 15_000 });
  await page.getByRole('button', { name: '500', exact: true }).click();
  await up.click();
  await expect(page.locator('.prediction-card')).toContainText('Вход', { timeout: 10_000 });
  await expect.poll(() => balance(page)).toBe(9500);

  // 30 секунд прогноза + расчёт
  const result = page.locator('.chart-dock button.block');
  await expect(result).toBeVisible({ timeout: 50_000 });
  const text = await result.innerText();
  const expected = /Выигрыш/.test(text) ? 10_425 : /Не в этот раз/.test(text) ? 9500 : 10_000;
  await expect.poll(() => balance(page)).toBe(expected);

  // история: та же сумма, проверка результата открывается и держит фокус
  await page.getByRole('link', { name: 'История' }).click();
  const row = page.locator('.history-row').first();
  await expect(row).toContainText('BTC/USD');
  await row.click();
  const dialog = page.getByRole('dialog', { name: 'Проверка результата' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Цена (середина)');
  await expect(dialog.getByRole('button', { name: 'Закрыть' })).toBeFocused();
  for (let i = 0; i < 5; i++) await page.keyboard.press('Tab');
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  expect(errors).toEqual([]);
});
