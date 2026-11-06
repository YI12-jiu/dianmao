/* 逐个验证 15 个教师账号能登录、进到自己的班级、名单人数正确 */
const { chromium } = require('playwright-core');
const path = require('path');

const EXE = path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe');
const BASE = process.env.BASE || 'http://127.0.0.1:8777';

const EXPECT = [
  ['t1001', '王砚秋', '高一（3）班', '880123', 8],
  ['t1002', '李清和', '高一（1）班', '880124', 6],
  ['t1003', '陈知远', '高一（2）班', '880125', 6],
  ['t1004', '周砚舟', '高一（4）班', '880126', 6],
  ['t1005', '沈书棠', '高一（5）班', '880127', 6],
  ['t1006', '许南枝', '高一（6）班', '880128', 6],
  ['t1007', '林见山', '高一（7）班', '880129', 6],
  ['t1008', '苏晚舟', '高二（1）班', '880130', 6],
  ['t1009', '顾清川', '高二（2）班', '880131', 6],
  ['t1010', '何岑', '高二（3）班', '880132', 6],
  ['t1011', '江照白', '高二（4）班', '880133', 6],
  ['t1012', '闻雪', '高三（1）班', '880134', 6],
  ['t1013', '段云起', '高三（2）班', '880135', 6],
  ['t1014', '白露', '高三（3）班', '880136', 6],
  ['t1015', '温言', '高三（4）班', '880137', 6]
];

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  const t0 = Date.now();
  await page.waitForTimeout(1200);
  console.log('首次播种耗时 ~' + (Date.now() - t0) + 'ms');

  let ok = 0;
  for (const [acc, name, cls, code, count] of EXPECT) {
    await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    await page.evaluate(() => Auth.logout());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    await page.fill('#account', acc);
    await page.fill('#password', '123456');
    await page.click('#submit');
    await page.waitForURL('**/teacher.html', { timeout: 15000 });
    await page.waitForTimeout(700);

    const gotName = (await page.textContent('#meName')).trim();
    const gotCls = (await page.textContent('#className')).trim();
    const gotMeta = (await page.textContent('#classMeta')).trim();
    const rows = await page.$$eval('#stuList .stu', (n) => n.length);

    const pass = gotName === name && gotCls === cls && gotMeta.indexOf(code) >= 0 && rows === count;
    if (pass) ok++;
    console.log(`${pass ? '✓' : '✗'} ${acc} ${gotName} / ${gotCls} / ${gotMeta} / 名单 ${rows} 人`);
  }

  console.log(`\n通过 ${ok}/${EXPECT.length}`);
  console.log('ERRORS:', errs.length ? JSON.stringify(errs.slice(0, 3)) : 'none');
  await browser.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
