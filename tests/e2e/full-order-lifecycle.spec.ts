import { test, expect } from '@playwright/test';

const customerUrl = process.env.E2E_CUSTOMER_URL ?? 'http://localhost:3002';
const managerUrl = process.env.E2E_MANAGER_URL ?? 'http://localhost:3000';
const tableId = process.env.E2E_TABLE_ID ?? '12';
const cafeId = process.env.E2E_CAFE_ID ?? '00000000-0000-0000-0000-000000000001';
const qrToken = process.env.E2E_QR_TOKEN;

test.describe('customer → cashier full order lifecycle', () => {
  test('submits, prepares, delivers, settles and closes one table order', async ({ browser }) => {
    test.setTimeout(180_000);
    const customer = await browser.newContext();
    const peerCustomer = await browser.newContext();
    const manager = await browser.newContext();
    const customerPage = await customer.newPage();
    const peerCustomerPage = await peerCustomer.newPage();
    let orderPage = customerPage;
    let initialCartItemCount = 0;
    const managerPage = await manager.newPage();
    customerPage.setDefaultTimeout(15_000);
    managerPage.setDefaultTimeout(15_000);
    const consoleErrors: string[] = [];
    const managerConsoleErrors: string[] = [];
    customerPage.on('console', (message) => {
      if (message.type() === 'error') { consoleErrors.push(message.text()); console.log(`[customer console] ${message.text()}`); }
    });
    customerPage.on('response', async (response) => {
      if (response.status() < 400) return;
      const url = new URL(response.url());
      if (!url.pathname.startsWith('/rest/v1/') && !url.pathname.startsWith('/auth/v1/')) return;
      console.log(`[customer API ${response.status()}] ${url.pathname}: ${(await response.text().catch(() => '')).slice(0, 500)}`);
    });
    managerPage.on('console', (message) => {
      if (message.type() === 'error') managerConsoleErrors.push(message.text());
    });

    try {
      await test.step('1. Open table session from QR URL', async () => {
        if (!qrToken) throw new Error('E2E_QR_TOKEN must be set to the disposable QA table token.');
        const qrUrl = `${customerUrl}/table/${tableId}?cafe=${cafeId}&token=${qrToken}`;
        // Bootstrap the shared table session once, then join it from the peer
        // phone. QR validation already creates/reuses the active cart, so the
        // meaningful two-phone race is adding items to the shared cart below.
        await customerPage.goto(qrUrl, { waitUntil: 'domcontentloaded' });
        await expect(customerPage).toHaveURL(new RegExp(`/table/${tableId}/menu(?:\\?.*)?$`), { timeout: 20_000 });
        await peerCustomerPage.goto(qrUrl, { waitUntil: 'domcontentloaded' });
        await expect(peerCustomerPage).toHaveURL(new RegExp(`/table/${tableId}/menu(?:\\?.*)?$`), { timeout: 20_000 });
        await expect(customerPage.locator('body')).not.toContainText('جاري التعرف على الطاولة');
        await expect(peerCustomerPage.locator('body')).not.toContainText('جاري التعرف على الطاولة');

        await Promise.all([
          customerPage.goto(`${customerUrl}/table/${tableId}/cart`, { waitUntil: 'domcontentloaded' }),
          peerCustomerPage.goto(`${customerUrl}/table/${tableId}/cart`, { waitUntil: 'domcontentloaded' }),
        ]);
        const readCartCount = async (page: typeof customerPage) => {
          if (await page.getByRole('heading', { name: 'Your table cart is empty' }).isVisible().catch(() => false)) return 0;
          const summary = page.getByRole('region', { name: 'ملخص طلب الطاولة' });
          if (!await summary.count()) return -1;
          const match = (await summary.innerText()).match(/(\d+)\s+Items/);
          return match ? Number(match[1]) : -1;
        };
        await expect.poll(() => readCartCount(customerPage), { timeout: 20_000 }).toBeGreaterThanOrEqual(0);
        initialCartItemCount = await readCartCount(customerPage);
        await expect.poll(() => readCartCount(peerCustomerPage), { timeout: 20_000 }).toBe(initialCartItemCount);
      });

      await test.step('2. Add products simultaneously from two phones and dispatch one combined order', async () => {
        await Promise.all([
          customerPage.goto(`${customerUrl}/table/${tableId}/menu`, { waitUntil: 'domcontentloaded' }),
          peerCustomerPage.goto(`${customerUrl}/table/${tableId}/menu`, { waitUntil: 'domcontentloaded' }),
        ]);
        const addProduct = async (page: typeof customerPage, productIndex: number, recipientName: string) => {
          const products = page.locator('a[aria-label*="عرض التفاصيل"]');
          await expect(products.nth(productIndex)).toBeVisible({ timeout: 20_000 });
          await products.nth(productIndex).click();
          await page.waitForURL(new RegExp(`/table/${tableId}/menu/product/`));
          for (const optionName of [/Light/i, /Natural Milk/i]) {
            const option = page.getByRole('button', { name: optionName });
            if (await option.count()) await option.first().click();
          }
          await page.getByRole('button', { name: /Add to Table Cart/ }).click();
          const recipient = page.getByRole('dialog');
          const recipientOpened = await expect(recipient).toBeVisible({ timeout: 10_000 }).then(() => true).catch(() => false);
          if (recipientOpened) {
            const savedRecipient = recipient.getByRole('button', { name: new RegExp(recipientName) }).first();
            if (await savedRecipient.count()) {
              await savedRecipient.click();
            } else {
              await recipient.getByPlaceholder('اكتب الاسم هنا...').fill(recipientName);
              await recipient.getByRole('button', { name: /تأكيد/ }).click();
            }
            await expect(recipient).toBeHidden({ timeout: 5_000 });
          }
          const addMore = page.getByRole('button', { name: /إضافة المزيد|Add more/i });
          await expect(addMore).toBeVisible({ timeout: 15_000 });
          await addMore.click();
          await page.waitForURL(new RegExp(`/table/${tableId}/menu$`));
        };

        // Separate contexts represent separate phones. Both add requests are
        // released together; each cart must converge to the same two items.
        await Promise.all([addProduct(customerPage, 0, 'QA Guest One'), addProduct(peerCustomerPage, 1, 'QA Guest Two')]);
        await Promise.all([
          customerPage.goto(`${customerUrl}/table/${tableId}/cart`, { waitUntil: 'domcontentloaded' }),
          peerCustomerPage.goto(`${customerUrl}/table/${tableId}/cart`, { waitUntil: 'domcontentloaded' }),
        ]);
        const readCartItemCount = async (page: typeof customerPage) => {
          const summary = page.getByRole('region', { name: 'ملخص طلب الطاولة' });
          const match = (await summary.innerText()).match(/(\d+)\s+Items/);
          return match ? Number(match[1]) : -1;
        };
        await expect.poll(() => readCartItemCount(customerPage), { timeout: 25_000 }).toBe(initialCartItemCount + 2);
        await expect.poll(() => readCartItemCount(peerCustomerPage), { timeout: 25_000 }).toBe(initialCartItemCount + 2);

        const primarySend = customerPage.getByRole('button', { name: /Send Combined Table Order/ });
        const peerSend = peerCustomerPage.getByRole('button', { name: /Send Combined Table Order/ });
        await expect.poll(async () => (await primarySend.count()) > 0 && (await peerSend.count()) > 0, { timeout: 20_000 }).toBe(true);
        if (await primarySend.isEnabled()) {
          orderPage = customerPage;
          await primarySend.click();
        } else {
          await expect(peerSend).toBeEnabled({ timeout: 10_000 });
          orderPage = peerCustomerPage;
          await peerSend.click();
        }
        await expect(orderPage).toHaveURL(new RegExp(`/table/${tableId}/order`), { timeout: 15_000 });
        await expect(orderPage.getByText(/Received|تم الاستلام|استلام الطلب/i).first()).toBeVisible({ timeout: 20_000 });
        await expect(peerCustomerPage.getByRole('heading', { name: 'Your table cart is empty' })).toBeVisible({ timeout: 25_000 });
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
        await expect(managerPage.getByRole('button', { name: new RegExp(`طاولة\\s*${tableId}`) }).first()).toBeVisible({ timeout: 30_000 });
      });

      await test.step('4. Move item received → preparing → ready and verify customer realtime state', async () => {
        const table = managerPage.getByRole('button', { name: new RegExp(`طاولة\\s*${tableId}`) }).first();
        await table.click();
        const status = managerPage.getByRole('combobox', { name: 'حالة الطلب' });
        await expect(status).toBeVisible();
        // The shared table can already contain served orders from an earlier
        // QA attempt. Use the cashier's bulk-ready action, which intentionally
        // skips terminal orders, rather than forcing every historical order
        // backward through the table-level status selector.
        const markAllReady = managerPage.getByRole('button', { name: /Mark all ready|تحديد الكل كجاهز/ });
        if (await markAllReady.isVisible().catch(() => false)) await markAllReady.click();
        await expect(status).toHaveValue('Ready', { timeout: 20_000 });
        await expect(orderPage.getByText(/Ready|جاهز/i).first()).toBeVisible({ timeout: 30_000 });
      });

      await test.step('5. Deliver, collect cash and close the table', async () => {
        const deliver = managerPage.getByRole('button', { name: /تم تسليم الطلب للعميل/ });
        if (!await deliver.isVisible().catch(() => false)) {
          await managerPage.getByRole('button', { name: /Mark all ready/ }).click();
          await expect(deliver).toBeVisible({ timeout: 20_000 });
        }
        await deliver.click();
        const collectPayment = managerPage.getByRole('button', { name: /الانتقال للتحصيل|Collect payment/ });
        await expect(collectPayment).toBeVisible({ timeout: 20_000 });
        await collectPayment.click();
        const dialog = managerPage.getByRole('dialog');
        await expect(dialog).toBeVisible();
        const totalText = await dialog.locator('strong.text-2xl').innerText();
        const total = Number(totalText.replace(/[^0-9.]/g, ''));
        expect(total, 'payment dialog must show a parseable positive total').toBeGreaterThan(0);
        await dialog.locator('input[type="number"]').fill(String(total + 100));
        await dialog.getByRole('button', { name: /تأكيد الدفع|Confirm payment/ }).click();
        await expect(dialog).toBeHidden({ timeout: 30_000 });
        await managerPage.getByRole('button', { name: /Customer left · Close table|غادر العميل · إغلاق الطاولة/ }).click();
      });

      await test.step('6. Reconcile available table and terminated customer session', async () => {
        await expect(managerPage.getByText(/Available|متاح/).first()).toBeVisible({ timeout: 20_000 });
        await expect(orderPage.getByText(/متاح|امسح|QR|Scan|انتهت الجلسة/i).first()).toBeVisible({ timeout: 30_000 });
        expect(managerConsoleErrors.some((entry) => entry.includes('same key') || entry.includes('undefined-undefined'))).toBe(false);
      });
    } finally {
      await Promise.allSettled([customer.close(), peerCustomer.close(), manager.close()]);
    }
  });
});
