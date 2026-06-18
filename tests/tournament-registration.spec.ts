import { test, expect } from '@playwright/test';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test.describe('赛事报名功能验收测试', () => {
  test.beforeEach(async ({ context, page }) => {
    await context.clearCookies();
    await page.goto('/tournaments');
    await page.waitForSelector('.tournament-card', { timeout: 15000 });
    await page.evaluate(() => {
      window.localStorage.clear();
      window.indexedDB.deleteDatabase('ggarena-db');
    });
    await page.reload();
    await page.waitForSelector('.tournament-card', { timeout: 15000 });
  });

  test('报名按钮与战队加载状态联动，加载完成后启用', async ({ page }) => {
    await page.goto('/tournaments');
    await page.waitForSelector('.tournament-card');

    const registrationCard = page.locator('.tournament-card', { hasText: 'Red Spike Open' });
    await expect(registrationCard).toBeVisible();
    await registrationCard.getByRole('link', { name: '查看详情' }).click();

    await page.waitForURL(/\/tournaments\/.+/);

    const registerButton = page.getByRole('button', { name: /报名/ });
    await expect(registerButton).toBeVisible();

    await expect(registerButton).toBeEnabled({ timeout: 10000 });
    const buttonText = await registerButton.textContent();
    expect(buttonText).toContain('报名');
    expect(buttonText).not.toContain('加载中');
  });

  test('无战队数据时按钮禁用且不提交空 teamId', async ({ page }) => {
    await page.goto('/tournaments');
    await page.waitForSelector('.tournament-card');

    const registrationCard = page.locator('.tournament-card', { hasText: 'Red Spike Open' });
    await expect(registrationCard).toBeVisible();
    await registrationCard.getByRole('link', { name: '查看详情' }).click();

    await page.waitForURL(/\/tournaments\/.+/);

    const registerButton = page.getByRole('button', { name: /报名/ });
    await expect(registerButton).toBeVisible();
    await expect(registerButton).toBeEnabled({ timeout: 10000 });

    const initialTeamCount = await page.locator('.card-grid .team-card').count();

    await page.evaluate(() => {
      return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('ggarena-db', 1);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('teams', 'readwrite');
          const store = tx.objectStore('teams');
          const clearReq = store.clear();
          clearReq.onsuccess = () => resolve();
          clearReq.onerror = () => reject(clearReq.error);
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      });
    });

    await page.reload();
    await page.waitForURL(/\/tournaments\/.+/);
    await page.waitForSelector('.detail-hero h1', { timeout: 15000 });

    const emptyButton = page.getByRole('button', { name: /暂无可报名战队/ });
    await expect(emptyButton).toBeVisible({ timeout: 10000 });

    const isDisabled = await emptyButton.evaluate((btn) => (btn as HTMLButtonElement).disabled);
    const teamCountAfterClear = await page.locator('.card-grid .team-card').count();

    expect(isDisabled).toBe(true);
    expect(teamCountAfterClear).toBe(0);

    await emptyButton.click({ force: true });
    await delay(300);

    const teamCountAfterClick = await page.locator('.card-grid .team-card').count();
    expect(teamCountAfterClick).toBe(teamCountAfterClear);
  });

  test('报名成功后当前赛事详情页立即显示新队伍', async ({ page }) => {
    await page.goto('/tournaments');
    await page.waitForSelector('.tournament-card');

    const targetTournament = page.locator('.tournament-card', { hasText: 'Utility Draft' });
    await expect(targetTournament).toBeVisible();

    await targetTournament.getByRole('link', { name: '查看详情' }).click();
    await page.waitForURL(/\/tournaments\/.+/);

    const registerButton = page.getByRole('button', { name: /报名/ });
    await expect(registerButton).toBeVisible();
    await expect(registerButton).toBeEnabled({ timeout: 10000 });

    const buttonText = await registerButton.textContent();
    if (buttonText?.includes('已报名')) {
      return;
    }

    const initialTeamCards = page.locator('.card-grid .team-card');
    const initialTeamCount = await initialTeamCards.count();

    await registerButton.click();

    await expect(registerButton).toContainText('已报名', { timeout: 10000 });

    const updatedTeamCards = page.locator('.card-grid .team-card');
    await expect(updatedTeamCards).toHaveCount(initialTeamCount + 1, { timeout: 5000 });

    const newTeamCard = page.locator('.card-grid .team-card', { hasText: 'North Byte' });
    await expect(newTeamCard).toBeVisible({ timeout: 5000 });
  });

  test('报名后返回赛事大厅，只有当前赛事队伍数更新，其他赛事不受影响', async ({ page }) => {
    await page.goto('/tournaments');
    await page.waitForSelector('.tournament-card');

    const allCardsBefore = page.locator('.tournament-card');
    const cardCountBefore = await allCardsBefore.count();
    expect(cardCountBefore).toBeGreaterThan(0);

    const tournamentStatesBefore: Array<{ name: string; teamCount: string }> = [];
    for (let i = 0; i < cardCountBefore; i++) {
      const card = allCardsBefore.nth(i);
      const name = await card.locator('h2').textContent();
      const teamCount = await card.locator('.stat-line span').first().textContent();
      tournamentStatesBefore.push({ name: name || '', teamCount: teamCount || '' });
    }

    const targetCardBefore = page.locator('.tournament-card', { hasText: 'Utility Draft' });
    const targetTeamCountBefore = await targetCardBefore.locator('.stat-line span').first().textContent();

    await targetCardBefore.getByRole('link', { name: '查看详情' }).click();
    await page.waitForURL(/\/tournaments\/.+/);

    const registerButton = page.getByRole('button', { name: /报名/ });
    await expect(registerButton).toBeVisible();
    await expect(registerButton).toBeEnabled({ timeout: 10000 });

    const buttonText = await registerButton.textContent();
    const wasRegistered = buttonText?.includes('已报名');

    if (!wasRegistered) {
      await registerButton.click();
      await expect(registerButton).toContainText('已报名', { timeout: 10000 });
    }

    await page.getByRole('link', { name: '赛事' }).click();
    await page.waitForURL('/tournaments');
    await page.waitForSelector('.tournament-card');

    const targetCardAfter = page.locator('.tournament-card', { hasText: 'Utility Draft' });
    const targetTeamCountAfter = await targetCardAfter.locator('.stat-line span').first().textContent();

    if (!wasRegistered) {
      const numBefore = parseInt(targetTeamCountBefore!.split('/')[0], 10);
      const numAfter = parseInt(targetTeamCountAfter!.split('/')[0], 10);
      expect(numAfter).toBe(numBefore + 1);
    }

    const allCardsAfter = page.locator('.tournament-card');
    const cardCountAfter = await allCardsAfter.count();
    expect(cardCountAfter).toBe(cardCountBefore);

    for (let i = 0; i < cardCountAfter; i++) {
      const card = allCardsAfter.nth(i);
      const name = await card.locator('h2').textContent();
      const beforeState = tournamentStatesBefore.find((s) => s.name === name);
      if (!beforeState) continue;

      if (name !== 'Utility Draft') {
        const teamCountAfter = await card.locator('.stat-line span').first().textContent();
        expect(teamCountAfter).toBe(beforeState.teamCount);
      }
    }
  });

  test('已报名后按钮禁用并显示"已报名"，防止重复提交', async ({ page }) => {
    await page.goto('/tournaments');
    await page.waitForSelector('.tournament-card');

    const targetCard = page.locator('.tournament-card', { hasText: 'Utility Draft' });
    await targetCard.getByRole('link', { name: '查看详情' }).click();
    await page.waitForURL(/\/tournaments\/.+/);

    const registerButton = page.getByRole('button', { name: /报名/ });
    await expect(registerButton).toBeVisible();
    await expect(registerButton).toBeEnabled({ timeout: 10000 });

    const buttonTextBefore = await registerButton.textContent();
    if (!buttonTextBefore?.includes('已报名')) {
      await registerButton.click();
      await expect(registerButton).toContainText('已报名', { timeout: 10000 });
    }

    await expect(registerButton).toBeDisabled();
    await expect(registerButton).toContainText('已报名');

    const initialTeamCards = page.locator('.card-grid .team-card');
    const initialTeamCount = await initialTeamCards.count();

    await registerButton.click({ force: true });
    await delay(500);

    const afterTeamCards = page.locator('.card-grid .team-card');
    const afterTeamCount = await afterTeamCards.count();
    expect(afterTeamCount).toBe(initialTeamCount);
  });
});
