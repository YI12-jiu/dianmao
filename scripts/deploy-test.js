/* 验证：本地页面 → 已发布的同步服务（跨域 + sharecode + Bearer） */
const { chromium } = require('playwright-core');
const path = require('path');

const EXE = path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe');
const BASE = 'http://127.0.0.1:8777';
const ENDPOINT = process.env.SYNC_URL || '';
const TOKEN = process.env.SYNC_TOKEN || '';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const errs = [];

  const a = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
  const pa = await a.newPage();
  pa.on('pageerror', (e) => errs.push('[A] ' + e.message));
  pa.on('console', (m) => { if (m.type() === 'error') errs.push('[A console] ' + m.text()); });

  await pa.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await pa.fill('#account', 't1001');
  await pa.fill('#password', '123456');
  await pa.click('#submit');
  await pa.waitForURL('**/teacher.html');
  await pa.waitForTimeout(800);

  const ping = await pa.evaluate(async ([url, token]) => {
    await Cloud.setEndpoint(url, token);
    return Cloud.test();
  }, [ENDPOINT, TOKEN]);
  console.log('测试连接:', JSON.stringify(ping));

  await pa.click('#allPresent');
  await pa.waitForTimeout(300);
  await pa.click('#saveAttend');
  await pa.waitForTimeout(2500);
  const st = await pa.evaluate(() => Cloud.syncNow().then(() => Cloud.state()));
  console.log('老师同步后:', JSON.stringify({ pending: st.pending, mode: st.mode, error: st.error, lastSync: !!st.lastSync }));

  /* 学生端：另一台设备，只配接口，不打开名单，验证能拉到老师刚存的数据 */
  const b = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-CN' });
  const pb = await b.newPage();
  pb.on('pageerror', (e) => errs.push('[B] ' + e.message));
  await pb.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await pb.evaluate(async ([url, token]) => {
    await Cloud.setEndpoint(url, token);
  }, [ENDPOINT, TOKEN]);
  await pb.click('.seg__btn[data-role="student"]');
  await pb.fill('#account', '2026002');
  await pb.fill('#password', '123456');
  await pb.click('#submit');
  await pb.waitForURL('**/student.html');
  await pb.waitForTimeout(800);

  const bState = await pb.evaluate(() => Cloud.syncNow().then(() => Cloud.state()));
  console.log('学生同步后:', JSON.stringify({ pending: bState.pending, mode: bState.mode, error: bState.error }));

  await pb.waitForTimeout(1200);
  const rate = await pb.textContent('#ringVal');
  const records = await pb.$$eval('#recordList .tl__row', (n) => n.length).catch(() => 0);
  console.log('学生看到的出勤率:', rate, '| 记录条数:', records);

  await pb.click('.tabbar button[data-page="records"]');
  await pb.waitForTimeout(600);
  const rows = await pb.$$eval('#recordList .tl__row', (n) => n.length).catch(() => 0);
  console.log('记录页条数:', rows);

  await pb.screenshot({ path: path.join(__dirname, '..', '_cloud.png') });
  console.log('ERRORS:', errs.length ? JSON.stringify(errs.slice(0, 6)) : 'none');
  await browser.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
