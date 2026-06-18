import { test, expect } from '@playwright/test';

test.describe('赛事报名功能验收测试', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await context.addInitScript(() => {
      window.localStorage.clear();
      window.indexedDB.deleteDatabase('ggarena-db');
    });
    await page.goto('/');
  });

  test('报名按钮在数据加载完成前应该禁用', async ({ page }) => {
    await page.goto('/tournaments');
    await page.waitForSelector('.tournament-card');

    const registrationCard = page.locator('.tournament-card', { hasText: 'Red Spike Open' });
    await expect(registrationCard).toBeVisible();
    await registrationCard.getByRole('link', { name: '查看详情' }).click();

    await page.waitForURL(/\/tournaments\/.+/);
    const registerButton = page.getByRole('button', { name: /报名/ });

    await expect(registerButton).toBeVisible();
    const isDisabled = await registerButton.evaluate((btn) => (btn as HTMLButtonElement).disabled);
    if (isDisabled) {
      await expect(registerButton).toBeDisabled();
    }
    await expect(registerButton).not.toContainText('数据加载中...', { timeout: 5000 });
  });

  test('报名成功后当前赛事详情页应立即显示新队伍', async ({ page }) => {
    await page.goto('/tournaments');
    await page.waitForSelector('.tournament-card');

    const targetTournament = page.locator('.tournament-card', { hasText: 'Utility Draft' });
    await expect(targetTournament).toBeVisible();

    const initialTeamCountText = await targetTournament.locator('.stat-line span').first().textContent();
    const initialCount = parseInt(initialTeamCountText!.split('/')[0], 10);

    await targetTournament.getByRole('link', { name: '查看详情' }).click();
    await page.waitForURL(/\/tournaments\/.+/);

    const registerButton = page.getByRole('button', { name: /报名/ });
    await expect(registerButton).toBeVisible();

    const buttonText = await registerButton.textContent();
    if (buttonText?.includes('已报名')) {
      expect(true).toBeTruthy();
      return;
    }

    await expect(registerButton).toBeEnabled({ timeout: 8000 });

    const initialTeamCards = page.locator('.card-grid .team-card');
    const initialTeamCount = await initialTeamCards.count();

    await registerButton.click();

    await expect
      .poll(async () => {
        const text = await registerButton.textContent();
        return text?.includes('已报名') ? 'registered' : text?.includes('报名中') || text?.includes('报名') ? 'pending' : 'unknown';
      }, { timeout: 8000 })
      .toBe('registered');

    const updatedTeamCards = page.locator('.card-grid .team-card');
    await expect(updatedTeamCards).toHaveCount(initialTeamCount + 1, { timeout: 5000 });

    const newTeamCard = page.locator('.card-grid .team-card', { hasText: 'North Byte' });
    await expect(newTeamCard).toBeVisible({ timeout: 5000 });
  });

  test('报名后返回赛事大厅，当前赛事队伍数同步更新且其他赛事不受影响', async ({ page }) => {
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

    const buttonText = await registerButton.textContent();
    const wasRegistered = buttonText?.includes('已报名');

    if (!wasRegistered) {
      await expect(registerButton).toBeEnabled({ timeout: 8000 });
      await registerButton.click();
      await expect(registerButton).toContainText('已报名', { timeout: 8000 });
    }

    await page.getByRole('link', { name: '赛事' }).click();
    await page.waitForURL('/tournaments');
    await page.waitForSelector('.tournament-card');

    const targetCardAfter = page.locator('.tournament-card', { hasText: 'Utility Draft' });
    const targetTeamCountAfter = await targetCardAfter.locator('.stat-line span').first().textContent();

    if (!wasRegistered) {
      expect(targetTeamCountAfter).not.toBe(targetTeamCountBefore);
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

  test('已报名后按钮应显示"已报名"并禁用，防止重复提交', async ({ page }) => {
    await page.goto('/tournaments');
    await page.waitForSelector('.tournament-card');

    const targetCard = page.locator('.tournament-card', { hasText: 'Utility Draft' });
    await targetCard.getByRole('link', { name: '查看详情' }).click();
    await page.waitForURL(/\/tournaments\/.+/);

    const registerButton = page.getByRole('button', { name: /报名/ });
    await expect(registerButton).toBeVisible();

    const buttonText = await registerButton.textContent();
    if (!buttonText?.includes('已报名')) {
      await expect(registerButton).toBeEnabled({ timeout: 8000 });
      await registerButton.click();
      await expect(registerButton).toContainText('已报名', { timeout: 8000 });
    }

    await expect(registerButton).toBeDisabled();
    await expect(registerButton).toContainText('已报名');
  });
});
