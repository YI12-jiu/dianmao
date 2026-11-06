const { chromium } = require('playwright-core');
const path = require('path');

const EXE = path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe');
const BASE = 'http://127.0.0.1:8777';
const API = 'http://127.0.0.1:8788';

(async () => {
  const NEW_NO = '2026' + String(Math.floor(Math.random() * 900) + 100);
  const browser = await chromium.launch({ executablePath: EXE });
  const errs = [];

  /* ---------- 设备 A：老师 ---------- */
  const a = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
  const pa = await a.newPage();
  pa.on('pageerror', (e) => errs.push('[A] ' + e.message));
  await pa.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await pa.fill('#account', 't1001');
  await pa.fill('#password', '123456');
  await pa.click('#submit');
  await pa.waitForURL('**/teacher.html');
  await pa.waitForTimeout(800);
  await pa.evaluate((api) => Cloud.setEndpoint(api, ''), API);
  await pa.evaluate(() => Cloud.syncNow());
  await pa.waitForTimeout(1200);
  const beforeCount = await pa.$$eval('#stuList .stu', (n) => n.length);
  console.log('A 初始名单:', beforeCount, '人');

  /* ---------- 设备 B：学生自助加入 ---------- */
  const b = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-CN' });
  const pb = await b.newPage();
  pb.on('pageerror', (e) => errs.push('[B] ' + e.message));
  await pb.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await pb.waitForTimeout(700);
  await pb.evaluate((api) => Cloud.setEndpoint(api, ''), API);
  await pb.click('#joinClass');
  await pb.fill('#joinCode', '880123');
  await pb.fill('#joinName', '张小明');
  await pb.fill('#joinNo', NEW_NO);
  await pb.fill('#joinPwd', 'abc123456');
  await pb.click('#joinDo');
  await pb.waitForURL('**/student.html', { timeout: 8000 });
  await pb.waitForTimeout(1000);
  await pb.evaluate(() => Cloud.syncNow());
  await pb.waitForTimeout(1200);
  console.log('B 已注册并推送:', await pb.textContent('#meName'));

  /* ---------- 设备 A 拉取 ---------- */
  await pa.evaluate(() => Cloud.syncNow());
  await pa.waitForTimeout(1600);
  await pa.click('.nav__btn[data-page="roster"]');
  await pa.waitForTimeout(700);
  const names = await pa.$$eval('#rosterList .stu', (rows) => rows.map((r) => r.innerText.replace(/\n/g, ' ')));
  console.log('A 拉取后名单:', names.length, '人');
  console.log('新同学是否出现:', names.some((n) => n.includes('张小明')));
  console.log('名单末位:', names[names.length - 1]);
  const chips = await pa.$$eval('#rosterList .chip', (c) => c.map((x) => x.textContent));
  console.log('待激活标记数:', chips.filter((c) => c.includes('待激活')).length);
  await pa.screenshot({ path: path.join(__dirname, '..', '_shots', '19-roster-merged.png') });

  /* ---------- B 端在学生自己的设备上可登录 ---------- */
  await pb.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await pb.waitForTimeout(600);
  const drop = await pb.$('#resumeDrop');
  if (drop) { await drop.click(); await pb.waitForTimeout(200); }
  await pb.click('.seg__btn[data-role="student"]');
  await pb.fill('#account', NEW_NO);
  await pb.fill('#password', 'abc123456');
  await pb.click('#submit');
  await pb.waitForURL('**/student.html', { timeout: 8000 });
  console.log('B 重新登录成功:', await pb.textContent('#meName'));

  console.log('ERRORS:', errs.length ? JSON.stringify(errs) : 'none');
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
