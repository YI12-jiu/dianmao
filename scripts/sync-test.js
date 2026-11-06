const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const EXE = path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe');
const BASE = 'http://127.0.0.1:8777';
const OUT = path.join(__dirname, '..', '_shots');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.fill('#account', 't1001');
  await page.fill('#password', '123456');
  await page.click('#submit');
  await page.waitForURL('**/teacher.html');
  await page.waitForTimeout(900);

  // 配置云端
  await page.click('.nav__btn[data-page="set"]');
  await page.waitForTimeout(300);
  await page.fill('#endpoint', 'http://127.0.0.1:8788');
  await page.click('#saveCloud');
  await page.waitForTimeout(500);
  await page.click('#testCloud');
  await page.waitForTimeout(1200);
  const toast = await page.textContent('.toast-layer');
  console.log('测试连接提示:', (toast || '').trim());

  // 点名并保存
  await page.click('.nav__btn[data-page="attend"]');
  await page.waitForTimeout(300);
  await page.click('#allPresent');
  await page.click('#saveAttend');
  await page.waitForTimeout(1800);

  await page.click('.nav__btn[data-page="set"]');
  await page.waitForTimeout(600);
  console.log('同步后队列:', (await page.textContent('#queueCount')).trim());
  console.log('云端状态:', (await page.textContent('#cloudDetail')).trim());
  await page.screenshot({ path: path.join(OUT, '17-cloud-connected.png') });

  // 断网保存
  await ctx.setOffline(true);
  await page.waitForTimeout(300);
  await page.click('.nav__btn[data-page="attend"]');
  await page.waitForTimeout(400);
  const rows = await page.$$('#stuList .stu');
  await (await rows[0].$('button[data-st="absent"]')).click();
  await page.click('#saveAttend');
  await page.waitForTimeout(800);
  const offlineToast = await page.textContent('.toast-layer');
  console.log('断网保存提示:', (offlineToast || '').trim());
  await page.click('.nav__btn[data-page="set"]');
  await page.waitForTimeout(500);
  console.log('断网时队列:', (await page.textContent('#queueCount')).trim());
  console.log('断网时状态:', (await page.textContent('#cloudDetail')).trim());
  await page.screenshot({ path: path.join(OUT, '18-offline-queued.png') });

  // 恢复网络，自动回传
  await ctx.setOffline(false);
  await page.waitForTimeout(26000);
  console.log('恢复网络后队列:', (await page.textContent('#queueCount')).trim());

  const dir = path.join(__dirname, '..', 'server', 'data');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  let total = 0;
  files.forEach((f) => { total += fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).length; });
  console.log('服务端累计记录:', total, files.join(','));

  console.log('ERRORS:', errs.length ? JSON.stringify(errs, null, 2) : 'none');
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
