import { expect, test } from '@playwright/test';

const notePath = '/note/1%E5%B9%B4%E7%94%9F/%E6%98%A5/%E7%B7%9A%E5%BD%A2%E4%BB%A3%E6%95%B0/01_%E8%A1%8C%E5%88%97%E3%81%A8%E6%BC%94%E7%AE%97.md';

test('ホームにカレンダー反映済みの概要が表示される', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByRole('heading', { name: 'ホーム' })).toBeVisible();
	await expect(page.getByText('今日の時間割')).toBeVisible();
	await expect(page.getByText('今週のカレンダー')).toBeVisible();
	await expect(page.getByRole('heading', { name: /未完了の課題/ })).toBeVisible();
	await expect(page.getByText(/時間割の読み込みに失敗|今日のカレンダー反映に失敗/)).toHaveCount(0);
});

test('カレンダーの月移動で表示月と時間割取得が更新される', async ({ page }) => {
	await page.goto('/calendar');

	const title = page.locator('h1').first();
	await expect(title).toHaveText(/\d{4}年 \d+月/);
	await expect(page.getByText('読み込み中…')).toHaveCount(0);
	const before = await title.textContent();

	await page.getByRole('button', { name: '次の月' }).click();

	await expect(title).not.toHaveText(before ?? '');
	await expect(page.getByText(/時間割の取得に失敗/)).toHaveCount(0);
});

test('ノート編集画面で未保存のまま移動すると確認される', async ({ page }) => {
	await page.goto(notePath);

	await expect(page.getByRole('heading', { name: '行列と演算' })).toBeVisible();
	await page.locator('.cm-content').click();
	await page.keyboard.type('\nE2E unsaved draft');

	page.once('dialog', async (dialog) => {
		expect(dialog.message()).toContain('未保存');
		await dialog.dismiss();
	});

	await page.getByRole('link', { name: 'ホームへ戻る' }).click();
	await expect(page).toHaveURL(new RegExp(`${notePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
	await expect(page.getByText('保存待ち')).toBeVisible();
});

test('ノート保存後もサイドバーの開閉状態が維持される', async ({ page }) => {
	await page.goto('/');

	await page.getByRole('button', { name: '春' }).first().click();
	await page.getByRole('button', { name: '線形代数', exact: true }).click();
	await page.getByRole('link', { name: '01_行列と演算.md' }).click();

	await expect(page).toHaveURL(new RegExp(`${notePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
	await expect(page.getByRole('link', { name: '01_行列と演算.md' })).toBeVisible();

	await page.locator('.cm-content').click();
	await page.keyboard.type(`\nE2E saved tree state ${Date.now()}`);
	await expect(page.getByText('保存待ち')).toBeVisible();

	const saveShortcut = process.platform === 'darwin' ? 'Meta+S' : 'Control+S';
	await page.keyboard.press(saveShortcut);

	await expect(page.getByText(/保存済み/)).toBeVisible();
	await expect(page.getByRole('button', { name: '春' }).first()).toBeVisible();
	await expect(page.getByRole('button', { name: '線形代数', exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: '01_行列と演算.md' })).toBeVisible();
});
