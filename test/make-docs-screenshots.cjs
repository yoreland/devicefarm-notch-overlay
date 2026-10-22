// 生成 README 用的截图到 docs/images/{en,zh}/（英文、中文标注各一套）。
// 用本地模拟控制台页（test/mock-session.html，设备画面是真机截图）+ 真实加载的扩展截图，
// 再用一个 HTML 拼图页把多张截图排版、加标注。
// 运行：npm run docs:screenshots   （需要系统装有中文字体，否则弹窗里的中文会显示成方框）
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const OUT = path.join(ROOT, 'docs/images');
const RAW = fs.mkdtempSync(path.join(os.tmpdir(), 'df-docs-raw-'));
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'https://us-west-2.console.aws.amazon.com/devicefarm/home';
const SESSION = '#/mobile/projects/p/sessions/s/00000/';

async function launch(withExt) {
  const args = ['--headless=new', '--lang=zh-CN'];
  if (withExt) args.push(`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`);
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'df-docs-')), {
    executablePath: process.env.CHROME_PATH || undefined,
    headless: false,
    locale: 'zh-CN',
    ignoreDefaultArgs: ['--disable-extensions'],
    viewport: { width: 1280, height: 1000 },
    deviceScaleFactor: 2,
    args
  });
  await ctx.route('https://us-west-2.console.aws.amazon.com/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/__fixtures/')) {
      return route.fulfill({ path: path.join(__dirname, 'fixtures', path.basename(url.pathname)), contentType: 'image/png' });
    }
    return route.fulfill({ path: path.join(__dirname, 'mock-session.html'), contentType: 'text/html' });
  });
  return ctx;
}

const raw = name => path.join(RAW, name);

async function phoneShot(page, file, { pad = 16, height } = {}) {
  const b = await page.locator('canvas#device').boundingBox();
  await page.screenshot({
    path: raw(file),
    clip: { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: height ?? b.height + pad * 2 }
  });
}

async function openSession(page, model) {
  await page.goto(BASE + (model ? '?model=' + encodeURIComponent(model) : '') + SESSION);
  await page.waitForSelector('canvas#device.is-connected');
  await page.waitForTimeout(600);
}

(async () => {
  // ---------- 安装前：不加载扩展 ----------
  {
    const ctx = await launch(false);
    const page = ctx.pages()[0] || (await ctx.newPage());
    await openSession(page);
    await phoneShot(page, 'before.png');
    await phoneShot(page, 'before-top.png', { height: 130 });
    await ctx.close();
  }

  // ---------- 加载扩展 ----------
  const ctx = await launch(true);
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const page = ctx.pages()[0] || (await ctx.newPage());
  for (const p of ctx.pages()) if (p !== page) await p.close();

  // 1) chrome://extensions：打开开发者模式，高亮开关和「加载已解压的扩展程序」
  await page.setViewportSize({ width: 1280, height: 560 });
  await page.goto('chrome://extensions');
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const mgr = document.querySelector('extensions-manager');
    const toolbar = mgr.shadowRoot.querySelector('extensions-toolbar');
    const dev = toolbar.shadowRoot.querySelector('#devMode');
    if (dev && !dev.checked) dev.click();
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const toolbar = document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-toolbar');
    const sr = toolbar.shadowRoot;
    const mark = (el, n) => {
      if (!el) return;
      el.style.outline = '3px solid #e8381e';
      el.style.outlineOffset = '4px';
      el.style.borderRadius = '6px';
      el.style.position = 'relative';
      const tag = document.createElement('span');
      tag.textContent = n;
      tag.style.cssText =
        'position:absolute;top:-14px;left:-14px;width:24px;height:24px;border-radius:50%;background:#e8381e;color:#fff;font:bold 14px/24px sans-serif;text-align:center;z-index:9';
      el.appendChild(tag);
    };
    mark(sr.querySelector('#devMode')?.parentElement || sr.querySelector('#devMode'), '1');
    mark(sr.querySelector('#loadUnpacked'), '2');
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: raw('extensions.png') });

  // 2) 安装后：竖屏
  await page.setViewportSize({ width: 1280, height: 1000 });
  await openSession(page);
  await page.waitForSelector('.df-notch-overlay[data-status="ok"]');
  await phoneShot(page, 'after.png');
  await phoneShot(page, 'after-top.png', { height: 130 });

  // 3) 横屏（canvas 变成横向时）
  await page.evaluate(() => window.__wide(true));
  await page.waitForTimeout(500);
  await phoneShot(page, 'landscape.png');
  await page.evaluate(() => window.__wide(false));

  // 4) 弹窗：把 chrome.tabs.query 指向会话页，让弹窗显示真实状态
  const openPopup = async () => {
    const ext = await ctx.newPage();
    await ext.setViewportSize({ width: 304, height: 330 });
    await ext.addInitScript(() => {
      const q = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = async () => {
        const self = await chrome.tabs.getCurrent();
        return (await q({})).filter(t => t.id !== self?.id);
      };
    });
    ext.on('pageerror', e => console.error('popup error:', e.message));
    await ext.goto(`chrome-extension://${extId}/popup.html`);
    await ext.waitForTimeout(500);
    return ext;
  };
  let pop = await openPopup();
  await pop.screenshot({ path: raw('popup.png'), fullPage: true });
  await pop.close();

  // 5) 未收录机型 → 手动选择
  await openSession(page, 'iPad Pro (11-inch)');
  await page.waitForSelector('.df-notch-overlay[data-status="no-device"]');
  await phoneShot(page, 'unknown.png', { height: 330 });
  pop = await openPopup();
  await pop.selectOption('#device', 'iphone 16');
  await pop.waitForTimeout(300);
  await pop.close();
  pop = await openPopup();
  await pop.screenshot({ path: raw('popup-manual.png'), fullPage: true });
  await pop.close();
  await page.bringToFront();
  await page.waitForSelector('.df-notch-overlay[data-status="ok"]');
  await phoneShot(page, 'manual-after.png', { height: 330 });

  // 6) 刘海不透明度调低（看清被挡住的内容）
  pop = await openPopup();
  await pop.evaluate(() => chrome.storage.local.set({ opts: { enabled: true, showCorners: false, cornerColor: 'black', opacity: 0.5, orientation: 'auto' } }));
  await pop.close();
  await openSession(page);
  await page.waitForTimeout(500);
  await phoneShot(page, 'opacity-top.png', { height: 130 });
  pop = await openPopup();
  await pop.evaluate(() => chrome.storage.local.remove('opts'));
  await pop.close();

  // ---------- 拼图排版（中英两套标注：docs/images/en、docs/images/zh） ----------
  const TEXT = {
    en: {
      before: 'Before', after: 'After',
      beforeSub: 'No Dynamic Island on the live screen — hard to tell what would be hidden on a real device',
      afterSub: 'Dynamic Island drawn for the detected model; clicks still reach the device',
      ext1: 'Turn on <b>Developer mode</b> (top right)',
      ext2: 'Click <b>Load unpacked</b> and select the unzipped <code>devicefarm-notch-overlay</code> folder',
      popup: [
        ['Status', 'whether the overlay is active, the model name found on the page, and the model profile in use'],
        ['启用 / Enable', 'master switch — uncheck to hide the overlay temporarily'],
        ['机型 / Model', '“自动识别” (auto-detect) by default; pick a model manually if detection fails or is wrong'],
        ['方向 / Orientation', 'keep “自动” (auto); if the cutout is on the wrong side in landscape, choose “横屏（刘海在右）” (landscape, cutout on right)'],
        ['刘海不透明度 / Cutout opacity', 'drag left to make it semi-transparent and see what is underneath'],
        ['屏幕圆角 / 圆角颜色 — Screen corners / corner color', 'off by default (the console already rounds the corners)']
      ],
      m1: '① “Unsupported model” badge', m2: '② Pick a model in the popup', m3: '③ Overlay uses the chosen model',
      op100: 'Opacity 100% (default)', op50: 'Opacity 50%',
      land: 'In landscape the Dynamic Island moves to the left edge. If your device is rotated the other way, choose “横屏（刘海在右）” (landscape, cutout on right) in the popup.'
    },
    zh: {
      before: '安装前', after: '安装后',
      beforeSub: '画面顶部看不到 Dynamic Island，无法判断内容会不会被挡住',
      afterSub: '按机型自动画出 Dynamic Island，点击照常传到真机',
      ext1: '打开右上角「开发者模式（Developer mode）」',
      ext2: '点「加载已解压的扩展程序（Load unpacked）」，选择解压出来的 <code>devicefarm-notch-overlay</code> 文件夹',
      popup: [
        ['状态栏', '显示是否已叠加、页面上识别到的型号、实际使用的机型参数'],
        ['启用', '总开关，临时不想看刘海就取消勾选'],
        ['机型', '默认「自动识别」；识别不到或不准时手动选一个'],
        ['方向', '一般保持「自动」；横屏时刘海方向反了就选「横屏（刘海在右）」'],
        ['刘海不透明度', '往左拖变半透明，可以看清被挡住的内容'],
        ['屏幕圆角 / 圆角颜色', '默认关闭（控制台已有圆角），需要更逼真时再打开']
      ],
      m1: '① 画面提示「未收录机型」', m2: '② 弹窗里手动选择机型', m3: '③ 按所选机型叠加',
      op100: '不透明度 100%（默认）', op50: '不透明度 50%',
      land: '横屏时 Dynamic Island 自动转到左侧；方向相反时在弹窗里选「横屏（刘海在右）」'
    }
  };

  const img = f => 'data:image/png;base64,' + fs.readFileSync(raw(f)).toString('base64');
  const board = await ctx.newPage();
  async function compose(dir, file, width, html) {
    await board.setViewportSize({ width, height: 400 });
    await board.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;padding:24px;background:#fff;font:15px/1.6 system-ui,"Noto Sans","Noto Sans SC",sans-serif;color:#16191f}
      .row{display:flex;gap:28px;align-items:flex-start;justify-content:center}
      .col{display:flex;flex-direction:column;align-items:center;gap:10px}
      .cap{font-weight:bold;font-size:16px;text-align:center}
      .sub{color:#5f6b7a;font-size:13px;text-align:center;max-width:320px}
      .arrow{align-self:center;font-size:34px;color:#e8381e;font-weight:bold}
      img{display:block;border-radius:8px;box-shadow:0 1px 6px rgba(0,0,0,.18)}
      .bad{color:#c7162b}.good{color:#1d8102}
      .n{display:inline-block;width:22px;height:22px;border-radius:50%;background:#e8381e;color:#fff;text-align:center;font:bold 13px/22px sans-serif;margin-right:6px}
      ol{margin:0;padding:0;list-style:none} li{margin:8px 0}
    </style></head><body>${html}</body></html>`);
    await board.waitForTimeout(200);
    const h = await board.evaluate(() => document.body.scrollHeight);
    await board.setViewportSize({ width, height: h });
    await board.screenshot({ path: path.join(dir, file) });
  }

  for (const [lang, t] of Object.entries(TEXT)) {
    const dir = path.join(OUT, lang);
    fs.mkdirSync(dir, { recursive: true });

    await compose(dir, 'before-after.png', 860, `
      <div class="row">
        <div class="col"><div class="cap bad">${t.before}</div><img src="${img('before.png')}" width="300"><div class="sub">${t.beforeSub}</div></div>
        <div class="arrow">→</div>
        <div class="col"><div class="cap good">${t.after}</div><img src="${img('after.png')}" width="300"><div class="sub">${t.afterSub}</div></div>
      </div>`);

    await compose(dir, 'before-after-top.png', 900, `
      <div class="row">
        <div class="col"><div class="cap bad">${t.before}</div><img src="${img('before-top.png')}" width="380"></div>
        <div class="col"><div class="cap good">${t.after}</div><img src="${img('after-top.png')}" width="380"></div>
      </div>`);

    await compose(dir, 'step1-extensions.png', 1000, `
      <img src="${img('extensions.png')}" width="950">
      <ol style="margin-top:14px">
        <li><span class="n">1</span>${t.ext1}</li>
        <li><span class="n">2</span>${t.ext2}</li>
      </ol>`);

    await compose(dir, 'popup.png', 860, `
      <div class="row">
        <img src="${img('popup.png')}" width="304">
        <ol style="max-width:480px">
          ${t.popup.map(([k, v], i) => `<li><span class="n">${i + 1}</span><b>${k}</b>${lang === 'zh' ? '：' : ': '}${v}</li>`).join('')}
        </ol>
      </div>`);

    await compose(dir, 'manual-select.png', 1060, `
      <div class="row">
        <div class="col"><div class="cap">${t.m1}</div><img src="${img('unknown.png')}" width="280"></div>
        <div class="arrow">→</div>
        <div class="col"><div class="cap">${t.m2}</div><img src="${img('popup-manual.png')}" width="304"></div>
        <div class="arrow">→</div>
        <div class="col"><div class="cap">${t.m3}</div><img src="${img('manual-after.png')}" width="280"></div>
      </div>`);

    await compose(dir, 'opacity.png', 900, `
      <div class="row">
        <div class="col"><div class="cap">${t.op100}</div><img src="${img('after-top.png')}" width="380"></div>
        <div class="col"><div class="cap">${t.op50}</div><img src="${img('opacity-top.png')}" width="380"></div>
      </div>`);

    await compose(dir, 'landscape.png', 960, `
      <div class="col"><img src="${img('landscape.png')}" width="900"><div class="sub" style="max-width:none">${t.land}</div></div>`);
  }

  await ctx.close();
  fs.rmSync(RAW, { recursive: true, force: true });
  console.log('screenshots written to', OUT, fs.readdirSync(OUT).map(d => `${d}: ${fs.readdirSync(path.join(OUT, d)).length}`));
})().catch(e => {
  console.error(e);
  process.exit(1);
});
