// 用 Playwright 加载已解压扩展，在本地模拟页上验证 overlay。
// 模拟页通过 context.route 挂在真实控制台 URL 下，这样 manifest 的 matches 不需要为测试放宽。
// 运行：npm install && npx playwright install chromium && npm test   （截图默认输出到 test-output/）
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const EXT = path.resolve(__dirname, '../extension');
const OUT = path.resolve(process.argv[2] || path.join(__dirname, '../test-output'));
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'https://us-west-2.console.aws.amazon.com/devicefarm/home';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-notch-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    executablePath: process.env.CHROME_PATH || undefined,
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    viewport: { width: 1600, height: 1000 },
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  await ctx.route('https://us-west-2.console.aws.amazon.com/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/__fixtures/')) {
      return route.fulfill({ path: path.join(__dirname, 'fixtures', path.basename(url.pathname)), contentType: 'image/png' });
    }
    return route.fulfill({ path: path.join(__dirname, 'mock-session.html'), contentType: 'text/html' });
  });

  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;

  const errors = [];
  const page = await ctx.newPage();
  for (const p of ctx.pages()) if (p !== page) await p.close(); // 只留一个页面 tab，便于扩展页找到它
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => m.type() === 'error' && errors.push('console: ' + m.text()));

  async function geometry() {
    return page.evaluate(() => {
      const r = el => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      };
      const ov = document.querySelector('.df-notch-overlay');
      return {
        canvas: r(document.querySelector('canvas#device')),
        overlay: r(ov),
        cutout: r(ov?.querySelector('[data-part="cutout"]')),
        corners: !!ov?.querySelector('[data-part="corners"]'),
        status: ov?.dataset.status,
        device: ov?.dataset.device,
        orientation: ov?.dataset.orientation,
        badge: ov?.children[1]?.style.display !== 'none' ? ov?.children[1]?.textContent : '',
        parentIsWrapper: ov?.parentElement?.classList.contains('device-screen-wrapper'),
        pe: ov && [getComputedStyle(ov).pointerEvents, getComputedStyle(ov.firstChild).pointerEvents],
        display: ov && getComputedStyle(ov).display
      };
    });
  }
  const waitStatus = (s, timeout = 5000) =>
    page.waitForFunction(s => document.querySelector('.df-notch-overlay')?.dataset.status === s, s, { timeout });

  // 1. iPhone 16 竖屏：自动识别 + 对齐
  await page.goto(BASE + '#/mobile/projects/p/sessions/s/00000/');
  await waitStatus('ok');
  let g = await geometry();
  check('overlay 出现并挂在 .device-screen-wrapper 内', g.parentIsWrapper && g.display === 'block', JSON.stringify(g.overlay));
  check('自动识别 aria-label → iphone 16', g.device === 'iphone 16');
  check('overlay 与 canvas 内容框对齐', ['x', 'y', 'w', 'h'].every(k => near(g.overlay[k], g.canvas[k], 0.5)));
  const k = g.canvas.w / 393;
  check(
    '岛位置 = (133.5,11,126,37)pt × k，水平居中',
    near(g.cutout.x - g.canvas.x, 133.5 * k) && near(g.cutout.y - g.canvas.y, 11 * k) && near(g.cutout.w, 126 * k) &&
      near(g.cutout.x + g.cutout.w / 2, g.canvas.x + g.canvas.w / 2, 1),
    `k=${k.toFixed(3)} cutout=${JSON.stringify(g.cutout)}`
  );
  check('pointer-events:none（容器与 SVG）', g.pe.every(v => v === 'none'), g.pe.join(','));
  check('屏幕圆角默认关闭', !g.corners);
  await page.screenshot({ path: path.join(OUT, 'mock-portrait.png') });
  await page.screenshot({
    path: path.join(OUT, 'mock-portrait-zoom.png'),
    clip: { x: g.canvas.x - 12, y: g.canvas.y - 12, width: g.canvas.w + 24, height: 120 }
  });

  // 2. 点击穿透
  const cx = g.cutout.x + g.cutout.w / 2;
  const cy = g.cutout.y + g.cutout.h / 2;
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [cx, cy]);
  check('岛中心 elementFromPoint 命中 #device-touch-feedback', hit === 'device-touch-feedback', hit);
  await page.mouse.click(cx, cy);
  const touches = await page.evaluate(() => window.__touches);
  check('点击岛区域，触控层收到事件', touches.length === 1 && near(touches[0].x, cx - g.canvas.x, 1), JSON.stringify(touches));
  await page.screenshot({ path: path.join(OUT, 'mock-click-through.png') });

  // 3. 布局平移（flash 条下推 56px）
  await page.evaluate(() => window.__shiftLayout());
  await page.waitForTimeout(300);
  g = await geometry();
  check('布局下移后 overlay 跟随', near(g.overlay.y, g.canvas.y, 0.5) && near(g.overlay.x, g.canvas.x, 0.5), `canvas.y=${g.canvas.y}`);

  // 4. Rotate：被裁剪的横屏 → 隐藏岛并显示角标；再 Rotate 回来恢复
  await page.click('[title="Rotate"]'); // flash 已显示，Rotate 后保持显示
  await waitStatus('landscape-cropped', 6000);
  g = await geometry();
  check('Rotate 后识别为被裁剪横屏：隐藏岛 + 角标', !g.cutout && g.orientation === 'cropped' && !!g.badge, g.badge);
  await page.screenshot({ path: path.join(OUT, 'mock-rotated.png') });
  await page.click('[title="Rotate"]');
  await waitStatus('ok', 6000);
  g = await geometry();
  check('Rotate 回竖屏后岛恢复', !!g.cutout && g.orientation === 'portrait');

  // 5. 横向 canvas（控制台若将来按横屏尺寸显示）→ 岛旋转到左侧
  await page.evaluate(() => window.__wide(true));
  await page.waitForTimeout(300);
  g = await geometry();
  check(
    '横向 canvas：岛竖向贴左侧、垂直居中',
    g.orientation === 'landscape-left' && g.cutout && g.cutout.h > g.cutout.w && g.cutout.x - g.canvas.x < 20 &&
      near(g.cutout.y + g.cutout.h / 2, g.canvas.y + g.canvas.h / 2, 1.5),
    JSON.stringify(g.cutout)
  );
  await page.screenshot({ path: path.join(OUT, 'mock-wide-landscape.png') });
  await page.evaluate(() => window.__wide(false));

  // 6. popup：圆角开关 + 手动选型（通过扩展页调用与 popup 相同的接口）
  const ext = await ctx.newPage();
  ext.on('pageerror', e => errors.push('popup pageerror: ' + e.message));
  ext.on('console', m => m.type() === 'error' && errors.push('popup console: ' + m.text()));
  await ext.goto(`chrome-extension://${extId}/popup.html`);
  await ext.waitForTimeout(300);
  const optionCount = await ext.$$eval('#device option', o => o.length);
  check('popup 列出 iPhone 机型', optionCount > 30, `${optionCount} 项`);
  await ext.screenshot({ path: path.join(OUT, 'mock-popup.png') });
  await ext.evaluate(async () => {
    const self = await chrome.tabs.getCurrent();
    const t = (await chrome.tabs.query({})).find(x => x.id !== self.id);
    await chrome.storage.local.set({ opts: { enabled: true, showCorners: true, cornerColor: 'black', opacity: 1, orientation: 'auto' } });
    await chrome.runtime.sendMessage({ type: 'set-tab-state', tabId: t.id, manualDevice: 'iphone 16 pro max' });
  });
  await page.bringToFront();
  await page.waitForFunction(() => document.querySelector('.df-notch-overlay')?.dataset.device === 'iphone 16 pro max');
  g = await geometry();
  check('popup 手动选型生效（iPhone 16 Pro Max）', g.device === 'iphone 16 pro max');
  check('屏幕圆角开关生效', g.corners);
  await page.screenshot({ path: path.join(OUT, 'mock-corners.png') });
  const st = await ext.evaluate(async () => {
    const self = await chrome.tabs.getCurrent();
    const t = (await chrome.tabs.query({})).find(x => x.id !== self.id);
    await chrome.runtime.sendMessage({ type: 'set-tab-state', tabId: t.id, manualDevice: null });
    await chrome.storage.local.remove('opts');
    return chrome.runtime.sendMessage({ type: 'get-tab-state', tabId: t.id });
  });
  check('background 记录识别结果', st.report?.detected === 'iphone 16', JSON.stringify(st.report));
  await ext.close();

  // 7. 其他机型：刘海 / SE / 非 iPhone
  for (const [model, expect] of [
    ['iPhone 13', 'notch'],
    ['iPhone SE (3rd generation)', 'none'],
    ['Google Pixel 8', 'no-device']
  ]) {
    await page.goto(BASE + '?model=' + encodeURIComponent(model) + '#/mobile/projects/p/sessions/s/00000/');
    await page.waitForFunction(() => document.querySelector('.df-notch-overlay')?.dataset.status, null, { timeout: 5000 });
    await page.waitForTimeout(200);
    g = await geometry();
    const tag = await page.evaluate(() => document.querySelector('.df-notch-overlay [data-part="cutout"]')?.tagName);
    if (expect === 'notch') check('iPhone 13 → 刘海（path）', g.device === 'iphone 13' && tag === 'path' && near(g.cutout.y, g.canvas.y, 0.5));
    if (expect === 'none') check('iPhone SE → 无刘海', g.device === 'iphone se' && !tag && g.status === 'ok');
    if (expect === 'no-device') check('Pixel 8 → 未收录机型角标', g.status === 'no-device' && /只支持 iPhone/.test(g.badge), g.badge);
    if (expect === 'notch') await page.screenshot({ path: path.join(OUT, 'mock-notch-iphone13.png'), clip: { x: g.canvas.x - 12, y: g.canvas.y - 12, width: g.canvas.w + 24, height: 120 } });
  }

  check('无 console 报错 / 页面异常', errors.length === 0, errors.join(' | '));
  await ctx.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(2);
});
