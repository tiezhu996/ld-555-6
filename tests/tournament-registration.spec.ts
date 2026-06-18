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

  test('模拟战队数据慢加载：加载中按钮禁用不提交，加载完成后报名→详情页立即新增 North Byte→大厅只更新当前赛事', async ({ context, page }) => {
    await context.clearCookies();

    await page.addInitScript(() => {
      const delayed = new WeakSet();
      const origGetAll = IDBObjectStore.prototype.getAll;
      IDBObjectStore.prototype.getAll = function (this: IDBObjectStore, query?: unknown, count?: number): IDBRequest {
        const req = origGetAll.call(this, query, count);
        if (this.name === 'teams') {
          delayed.add(req);
        }
        return req;
      };

      let done = false;
      function patch() {
        if (done) return;
        let target: object | null = IDBRequest.prototype;
        while (target && target !== Object.prototype) {
          const desc = Object.getOwnPropertyDescriptor(target, 'onsuccess');
          if (desc && desc.set) {
            done = true;
            const origSet = desc.set;
            Object.defineProperty(IDBRequest.prototype, 'onsuccess', {
              set(this: IDBRequest, fn: ((this: IDBRequest, ev: Event) => unknown) | null) {
                if (delayed.has(this) && fn) {
                  const origFn = fn;
                  return origSet.call(this, function (this: IDBRequest, ev: Event) {
                    setTimeout(() => origFn.call(this, ev), 1500);
                  });
                }
                return origSet.call(this, fn);
              },
              configurable: true,
            });
            return;
          }
          target = Object.getPrototypeOf(target);
        }
      }
      patch();
      if (!done) {
        const timer = setInterval(() => {
          patch();
          if (done) clearInterval(timer);
        }, 10);
      }
    });

    await page.goto('/tournaments');
    await page.waitForSelector('.tournament-card', { timeout: 15000 });
    await page.evaluate(() => {
      window.localStorage.clear();
      window.indexedDB.deleteDatabase('ggarena-db');
    });
    await page.reload();
    await page.waitForSelector('.tournament-card', { timeout: 20000 });

    const tournamentStatesBefore: Array<{ name: string; teamCount: string }> = [];
    const allCardsBefore = page.locator('.tournament-card');
    const cardCountBefore = await allCardsBefore.count();
    expect(cardCountBefore).toBeGreaterThan(0);
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
    await page.waitForSelector('.detail-hero h1', { timeout: 15000 });

    const loadingButton = page.getByRole('button', { name: /数据加载中/ });
    await expect(loadingButton).toBeVisible({ timeout: 3000 });
    await expect(loadingButton).toBeDisabled();

    const initialTeamCardsDuringLoading = page.locator('.card-grid .team-card');
    const initialTeamCountDuringLoading = await initialTeamCardsDuringLoading.count();

    await loadingButton.click({ force: true });
    await delay(500);

    const teamCountAfterForceClick = await page.locator('.card-grid .team-card').count();
    expect(teamCountAfterForceClick).toBe(initialTeamCountDuringLoading);

    const registerButton = page.getByRole('button', { name: /报名 North Byte/ });
    await expect(registerButton).toBeVisible({ timeout: 5000 });
    await expect(registerButton).toBeEnabled();

    const initialTeamCards = page.locator('.card-grid .team-card');
    const initialTeamCount = await initialTeamCards.count();

    await registerButton.click();

    await expect(page.getByRole('button', { name: /已报名/ })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /已报名/ })).toBeDisabled();

    const updatedTeamCards = page.locator('.card-grid .team-card');
    await expect(updatedTeamCards).toHaveCount(initialTeamCount + 1, { timeout: 5000 });

    const northByteCard = page.locator('.card-grid .team-card', { hasText: 'North Byte' });
    await expect(northByteCard).toBeVisible({ timeout: 5000 });

    await page.getByRole('link', { name: '赛事' }).click();
    await page.waitForURL('/tournaments');
    await page.waitForSelector('.tournament-card');

    const targetCardAfter = page.locator('.tournament-card', { hasText: 'Utility Draft' });
    const targetTeamCountAfter = await targetCardAfter.locator('.stat-line span').first().textContent();

    const numBefore = parseInt(targetTeamCountBefore!.split('/')[0], 10);
    const numAfter = parseInt(targetTeamCountAfter!.split('/')[0], 10);
    expect(numAfter).toBe(numBefore + 1);

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
      await expect(page.getByRole('button', { name: /已报名/ })).toBeVisible({ timeout: 10000 });
    }

    const registeredButton = page.getByRole('button', { name: /已报名/ });
    await expect(registeredButton).toBeDisabled();
    await expect(registeredButton).toContainText('已报名');

    const initialTeamCards = page.locator('.card-grid .team-card');
    const initialTeamCount = await initialTeamCards.count();

    await registeredButton.click({ force: true });
    await delay(500);

    const afterTeamCards = page.locator('.card-grid .team-card');
    const afterTeamCount = await afterTeamCards.count();
    expect(afterTeamCount).toBe(initialTeamCount);
  });
});
