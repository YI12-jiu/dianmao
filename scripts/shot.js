const { chromium } = require('playwright-core');
const path = require('path');
const os = require('os');

const EXE = path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe');
const BASE = 'http://127.0.0.1:8777';
const OUT = path.join(__dirname, '..', '_shots');

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const errors = [];

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'zh-CN' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: path.join(OUT, '01-login.png') });

  // 学生端切换
  await page.click('.seg__btn[data-role="student"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, '02-login-student.png') });

  // 老师端登录
  await page.click('.seg__btn[data-role="teacher"]');
  await page.fill('#account', 't1001');
  await page.fill('#password', '123456');
  await page.click('#submit');
  await page.waitForURL('**/teacher.html', { timeout: 8000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, '03-teacher-attend.png') });

  // 标记几个人
  const segs = await page.$$('#stuList .stu');
  if (segs.length >= 3) {
    await (await segs[1].$('button[data-st="absent"]')).click();
    await (await segs[2].$('button[data-st="late"]')).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, '04-teacher-marked.png') });
    await page.click('#saveAttend');
    await page.waitForTimeout(700);
  }

  // 统计
  await page.click('.nav__btn[data-page="stats"]');
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, '05-teacher-stats.png') });

  // 学生页
  await page.click('.nav__btn[data-page="roster"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '06-teacher-roster.png') });

  // 设置
  await page.click('.nav__btn[data-page="set"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '07-teacher-set.png') });

  // 学生端
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, '08-resume.png') });
  await page.click('#resumeDrop');
  await page.waitForTimeout(300);
  await page.click('.seg__btn[data-role="student"]');
  await page.fill('#account', '2026001');
  await page.fill('#password', '123456');
  await page.click('#submit');
  await page.waitForURL('**/student.html', { timeout: 8000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, '09-student-home.png') });

  await page.click('#checkBtn');
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, '10-student-checked.png') });

  await page.click('.nav__btn[data-page="records"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, '11-student-records.png') });

  await page.click('.nav__btn[data-page="timetable"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '12-student-timetable.png') });

  // 移动端
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-CN' });
  const mp = await m.newPage();
  mp.on('pageerror', (e) => errors.push('[m-pageerror] ' + e.message));
  await mp.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await mp.waitForTimeout(1200);
  await mp.screenshot({ path: path.join(OUT, '13-m-login.png'), fullPage: true });
  await mp.click('.seg__btn[data-role="teacher"]');
  await mp.fill('#account', 't1001');
  await mp.fill('#password', '123456');
  await mp.click('#submit');
  await mp.waitForURL('**/teacher.html', { timeout: 8000 });
  await mp.waitForTimeout(1000);
  await mp.screenshot({ path: path.join(OUT, '14-m-teacher.png') });

  // 学生端（移动端）：先退出再用学生账号登录
  await mp.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await mp.waitForTimeout(600);
  const drop = await mp.$('#resumeDrop');
  if (drop) { await drop.click(); await mp.waitForTimeout(200); }
  await mp.click('.seg__btn[data-role="student"]');
  await mp.fill('#account', '2026001');
  await mp.fill('#password', '123456');
  await mp.click('#submit');
  await mp.waitForURL('**/student.html', { timeout: 8000 });
  await mp.waitForTimeout(1000);
  await mp.screenshot({ path: path.join(OUT, '15-m-student.png') });
  await mp.click('#checkBtn');
  await mp.waitForTimeout(600);
  await mp.screenshot({ path: path.join(OUT, '16-m-student-checked.png') });

  await browser.close();
  console.log('ERRORS:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
