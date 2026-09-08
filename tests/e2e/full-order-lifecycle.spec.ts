import { test, expect } from '@playwright/test';

const customerUrl = process.env.E2E_CUSTOMER_URL ?? 'http://localhost:3002';
const managerUrl = process.env.E2E_MANAGER_URL ?? 'http://localhost:3000';
const tableId = process.env.E2E_TABLE_ID ?? '14';
const cafeId = process.env.E2E_CAFE_ID ?? '00000000-0000-0000-0000-000000000001';

test.describe('customer → cashier full order lifecycle', () => {
  test('submits, prepares, delivers, settles and closes one table order', async ({ browser }) => {
    test.setTimeout(180_000);
    const customer = await browser.newContext();
    const manager = await browser.newContext();
    const customerPage = await customer.newPage();
    const managerPage = await manager.newPage();
    customerPage.setDefaultTimeout(15_000);
    managerPage.setDefaultTimeout(15_000);
    const consoleErrors: string[] = [];
    const managerConsoleErrors: string[] = [];
    customerPage.on('console', (message) => {
      if (message.type() === 'error') { consoleErrors.push(message.text()); console.log(`[customer console] ${message.text()}`); }
    });
    customerPage.on('response', (response) => {
      if (response.status() === 404) console.log(`[customer 404] ${response.url()}`);
    });
    managerPage.on('console', (message) => {
      if (message.type() === 'error') managerConsoleErrors.push(message.text());
    });

    try {
      await test.step('1. Open table session from QR URL', async () => {
        await customerPage.goto(`${customerUrl}/table/${tableId}?cafe=${cafeId}`, { waitUntil: 'domcontentloaded' });
        await expect(customerPage).toHaveURL(new RegExp(`/table/${tableId}/menu$`), { timeout: 20_000 });
        await expect(customerPage.locator('body')).not.toContainText('جاري التعرف على الطاولة');
      });

      await test.step('2. Add two products and dispatch one combined order', async () => {
        const products = customerPage.locator('a[aria-label*="عرض التفاصيل"]');
        await expect(products.nth(1)).toBeVisible({ timeout: 20_000 });
        for (let index = 0; index < 2; index += 1) {
          await products.nth(index).click();
          await customerPage.waitForURL(new RegExp(`/table/${tableId}/menu/product/`));
          for (const optionName of [/Light/i, /Natural Milk/i]) {
            const option = customerPage.getByRole('button', { name: optionName });
            if (await option.count()) await option.first().click();
          }
          await customerPage.getByRole('button', { name: /Add to Table Cart/ }).click();
          const recipient = customerPage.getByRole('dialog');
          const recipientOpened = await expect(recipient).toBeVisible({ timeout: 10_000 }).then(() => true).catch(() => false);
          if (recipientOpened) {
            await recipient.getByRole('button', { name: 'G Guest' }).last().click();
            await expect(recipient).toBeHidden({ timeout: 5_000 });
          }
          const addMore = customerPage.getByRole('button', { name: /إضافة المزيد|Add more/i });
          await expect(addMore).toBeVisible({ timeout: 15_000 });
          await addMore.click();
          await customerPage.waitForURL(new RegExp(`/table/${tableId}/menu$`));
        }
        await customerPage.goto(`${customerUrl}/table/${tableId}/cart`, { waitUntil: 'domcontentloaded' });
        await expect(customerPage.getByRole('button', { name: /Send Combined Table Order/ })).toBeVisible({ timeout: 20_000 });
        await customerPage.getByRole('button', { name: /Send Combined Table Order/ }).click();
        await expect(customerPage).toHaveURL(new RegExp(`/table/${tableId}/order`), { timeout: 15_000 });
        await expect(customerPage.getByText(/Received|تم الاستلام|استلام الطلب/i).first()).toBeVisible({ timeout: 20_000 });
        expect(consoleErrors.some((entry) => entry.includes('crypto.randomUUID'))).toBe(false);
      });

      await test.step('3. Authenticate cashier and verify realtime arrival', async () => {
        await managerPage.goto(`${managerUrl}/login`, { waitUntil: 'domcontentloaded' });
        const email = process.env.E2E_MANAGER_EMAIL;
        const password = process.env.E2E_MANAGER_PASSWORD;
        if (await managerPage.getByRole('heading', { name: /تسجيل الدخول/ }).count()) {
          if (!email || !password) throw new Error('Bottleneck: set E2E_MANAGER_EMAIL and E2E_MANAGER_PASSWORD for cashier authentication.');
          await managerPage.locator('input[type="email"]').fill(email);
          await managerPage.locator('input[type="password"]').fill(password);
          await managerPage.getByRole('button', { name: /دخول|تسجيل/ }).click();
          await expect(managerPage).toHaveURL(/\/dashboard/, { timeout: 15_000 });
        }
        await managerPage.goto(`${managerUrl}/orders`, { waitUntil: 'domcontentloaded' });
        await expect(managerPage.getByText(new RegExp(`Table\\s*${tableId}`)).first()).toBeVisible({ timeout: 30_000 });
      });

      await test.step('4. Move item received → preparing → ready and verify customer realtime state', async () => {
        const table = managerPage.getByRole('button', { name: new RegExp(`Table\\s*${tableId}`) }).first();
        await table.click();
        const drinkRow = managerPage.locator('article.premium-drink-row').first();
        const status = drinkRow.getByRole('button', { name: /Received|New|Preparing|Ready/ }).first();
        await status.click();
        await drinkRow.getByRole('option', { name: /Preparing/ }).click();
        await expect(status).toHaveText(/Preparing/);
        await status.click();
        await drinkRow.getByRole('option', { name: /Ready/ }).click();
        await expect(status).toHaveText(/Ready/);
        await expect(customerPage.getByText(/Ready|جاهز/i).first()).toBeVisible({ timeout: 30_000 });
      });

      await test.step('5. Deliver, collect cash and close the table', async () => {
        const deliver = managerPage.getByRole('button', { name: /تم تسليم الطلب للعميل/ });
        if (!await deliver.isVisible().catch(() => false)) {
          await managerPage.getByRole('button', { name: /Mark all ready/ }).click();
          await expect(deliver).toBeVisible({ timeout: 20_000 });
        }
        await deliver.click();
        await managerPage.getByRole('button', { name: /الانتقال للتحصيل|Collect Cash/ }).click();
        const dialog = managerPage.getByRole('dialog');
        await expect(dialog).toBeVisible();
        const totalText = await dialog.locator('strong').filter({ hasText: /EGP/ }).last().innerText();
        const total = Number(totalText.replace(/[^0-9.]/g, '')) || 10000;
        await dialog.locator('input[type="number"]').fill(String(total + 100));
        await dialog.getByRole('button', { name: /تأكيد الدفع/ }).click();
        await expect(dialog).toBeHidden({ timeout: 30_000 });
        await managerPage.getByRole('button', { name: /Customer left · Close table/ }).click();
        await expect(managerPage.getByText(new RegExp(`Table\\s*${tableId}`)).first()).toBeVisible();
      });

      await test.step('6. Reconcile available table and terminated customer session', async () => {
        await expect(managerPage.getByText(/Available|متاح/).first()).toBeVisible({ timeout: 20_000 });
        await expect(customerPage.getByText(/متاح|امسح|QR|Scan|انتهت الجلسة/i).first()).toBeVisible({ timeout: 30_000 });
        expect(managerConsoleErrors.some((entry) => entry.includes('same key') || entry.includes('undefined-undefined'))).toBe(false);
      });
    } finally {
      await Promise.allSettled([customer.close(), manager.close()]);
    }
  });
});
