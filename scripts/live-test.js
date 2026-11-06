/* 线上验收：GitHub Pages + 托管同步服务，全程不手动填接口地址 */
const { chromium } = require('playwright-core');
const path = require('path');

const EXE = path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe');
const SITE = 'https://yi12-jiu.github.io/dianmao/';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, proxy: { server: 'http://127.0.0.1:52501' } });
  const errs = [];

  const a = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
  const pa = await a.newPage();
  pa.on('pageerror', (e) => errs.push('[A] ' + e.message));
  pa.on('console', (m) => { if (m.type() === 'error') errs.push('[A console] ' + m.text()); });

  await pa.goto(SITE, { waitUntil: 'networkidle', timeout: 45000 });
  await pa.waitForTimeout(1500);
  console.log('登录页底部状态:', (await pa.textContent('.gate__foot')).replace(/\s+/g, ' ').trim());

  await pa.fill('#account', 't1001');
  await pa.fill('#password', '123456');
  await pa.click('#submit');
  await pa.waitForURL('**/teacher.html', { timeout: 20000 });
  await pa.waitForTimeout(1500);

  const mode0 = await pa.evaluate(() => Cloud.state());
  console.log('老师端接口模式:', mode0.mode, '| 地址:', mode0.endpoint);

  await pa.click('#allPresent');
  await pa.waitForTimeout(300);
  await pa.click('#saveAttend');
  await pa.waitForTimeout(3000);

  const mode1 = await pa.evaluate(() => Cloud.syncNow().then(() => Cloud.state()));
  console.log('老师保存后:', JSON.stringify({ pending: mode1.pending, error: mode1.error, synced: !!mode1.lastSync }));
  console.log('顶栏胶囊:', (await pa.textContent('#syncHost')).trim());

  /* 学生：全新设备 */
  const b = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-CN' });
  const pb = await b.newPage();
  pb.on('pageerror', (e) => errs.push('[B] ' + e.message));
  await pb.goto(SITE, { waitUntil: 'networkidle', timeout: 45000 });
  await pb.waitForTimeout(1200);
  await pb.click('.seg__btn[data-role="student"]');
  await pb.fill('#account', '2026002');
  await pb.fill('#password', '123456');
  await pb.click('#submit');
  await pb.waitForURL('**/student.html', { timeout: 20000 });
  await pb.waitForTimeout(1200);

  const mode2 = await pb.evaluate(() => Cloud.syncNow().then(() => Cloud.state()));
  console.log('学生同步后:', JSON.stringify({ pending: mode2.pending, error: mode2.error }));
  await pb.waitForTimeout(1200);

  const rate = await pb.textContent('#ringVal');
  await pb.click('.tabbar button[data-page="records"]');
  await pb.waitForTimeout(800);
  const rows = await pb.$$eval('#recordList .tl__row', (n) => n.length);
  const first = rows ? (await pb.$$eval('#recordList .tl__row .tl__what span', (n) => n.slice(0, 2).map((x) => x.textContent))) : [];
  console.log('学生出勤率:', rate, '| 云端拉到的记录:', rows, '条');
  console.log('记录样例:', first.join(' / '));

  await pb.screenshot({ path: path.join(__dirname, '..', '_cloud.png') });
  console.log('ERRORS:', errs.length ? JSON.stringify(errs.slice(0, 5)) : 'none');
  await browser.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
