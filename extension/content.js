// Device Farm 远程访问画面刘海 / Dynamic Island 叠加（仅视觉，pointer-events:none）
// 实测 DOM（2026-10，iPhone 16）：画面是顶层文档里的 canvas#device.is-connected，
// 父元素 .device-screen-wrapper 为 position:relative；触控层 #device-touch-feedback z-index 3，外框 #device-border-overlay z-index 5。
// overlay 挂到 canvas 的 offsetParent（即 wrapper）里，z-index 4：盖住画面和触控层、被外框压住，并随布局平移自动跟随。
(() => {
  if (globalThis.__dfNotchOverlay) return;
  globalThis.__dfNotchOverlay = true;

  const DEVICES = globalThis.DF_DEVICES;
  const findDevice = globalThis.DF_findDevice;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const BEZEL_COLOR = '#232f3e'; // 控制台外框颜色 rgb(35,47,62)
  const DEFAULT_OPTS = {
    enabled: true,
    showCorners: false, // 屏幕圆角默认关闭
    cornerColor: 'black', // 'black' | 'bezel'
    opacity: 1,
    orientation: 'auto' // 'auto' | 'portrait' | 'landscape-left' | 'landscape-right'
  };

  let opts = { ...DEFAULT_OPTS };
  let manualDevice = null;
  let screenEl = null;
  let overlay = null;
  let croppedLandscape = false;
  let pendingCropped = null;
  let samplingBroken = false;
  let lastReport = '';
  let raf = 0;

  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };
  const send = msg => {
    if (!alive()) return Promise.resolve(null);
    return chrome.runtime.sendMessage(msg).catch(() => null);
  };

  // ---------- 定位画面元素 ----------
  function isPhoneShaped(el) {
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w < 150 || h < 150) return false;
    const ar = w / h;
    return (ar > 0.4 && ar < 0.6) || (ar > 1.6 && ar < 2.4);
  }

  function findScreen() {
    const exact = document.querySelector('canvas#device');
    if (exact) return exact.classList.contains('is-connected') ? exact : null; // 连接前是 20em 占位
    const labelled = document.querySelector('canvas[role="img"][aria-label^="Live screen of"]');
    if (labelled) return labelled;
    // 启发式兜底：面积最大、形状像手机的 canvas/video/img，排除触控层
    let best = null;
    let bestArea = 0;
    for (const el of document.querySelectorAll('canvas, video, img')) {
      if (el.id === 'device-touch-feedback' || (overlay && overlay.contains(el)) || !isPhoneShaped(el)) continue;
      const area = el.offsetWidth * el.offsetHeight;
      if (area > bestArea) {
        best = el;
        bestArea = area;
      }
    }
    return best;
  }

  // ---------- 识别型号 ----------
  function modelText(el) {
    const sources = [
      el?.getAttribute('aria-label'),
      document.getElementById('device-touch-feedback')?.getAttribute('aria-label'),
      document.querySelector('h1')?.textContent,
      document.title
    ];
    for (const s of sources) {
      const m = /\b(iPhone[^|()\n]*)/i.exec(s || '');
      if (m) return m[1].trim();
    }
    // 非 iPhone：仍返回原始型号，用于角标提示
    return /^Live screen of\s+(.+)$/i.exec(el?.getAttribute('aria-label') || '')?.[1].trim() || null;
  }

  // ---------- 内容框（考虑 object-fit:contain 的 letterbox） ----------
  function contentBox(el, host) {
    // 用 getBoundingClientRect 取小数精度（offset* 会取整，369.3px 宽的 canvas 会差 0.3px）；结果相对 host，随布局平移自动跟随
    const r = el.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    const w = r.width;
    const h = r.height;
    const iw = el.videoWidth || el.naturalWidth || el.width;
    const ih = el.videoHeight || el.naturalHeight || el.height;
    const fit = getComputedStyle(el).objectFit;
    let bw = w;
    let bh = h;
    if (iw && ih && (fit === 'contain' || fit === 'scale-down')) {
      const s = Math.min(w / iw, h / ih);
      bw = iw * s;
      bh = ih * s;
    }
    const left = r.left - hr.left - host.clientLeft + host.scrollLeft;
    const top = r.top - hr.top - host.clientTop + host.scrollTop;
    return { left: left + (w - bw) / 2, top: top + (h - bh) / 2, width: bw, height: bh };
  }

  // ---------- 横屏检测 ----------
  // 实测：iOS 横屏时 canvas 尺寸不变（仍是竖屏 554×1200），横屏帧按同比例画在中间带（约 27%–73% 高度），左右被裁掉。
  // 所以低频抽样像素：上下两端全黑、中间有内容 → 判定为"被裁剪的横屏"，此时刘海/岛不在可见区域内。
  const sampler = document.createElement('canvas');
  sampler.width = 48;
  sampler.height = 104;
  function sampleCroppedLandscape(el) {
    const ctx = sampler.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, sampler.width, sampler.height);
    ctx.drawImage(el, 0, 0, sampler.width, sampler.height);
    const data = ctx.getImageData(0, 0, sampler.width, sampler.height).data;
    const rowMax = [];
    for (let y = 0; y < sampler.height; y++) {
      let max = 0;
      for (let x = 0; x < sampler.width; x++) {
        const i = (y * sampler.width + x) * 4;
        const v = data[i + 3] ? (data[i] + data[i + 1] + data[i + 2]) / 3 : 0;
        if (v > max) max = v;
      }
      rowMax.push(max);
    }
    const H = sampler.height;
    const black = (a, b) => rowMax.slice(Math.floor(a * H), Math.ceil(b * H)).every(v => v < 20);
    const mid = rowMax.slice(Math.floor(0.35 * H), Math.ceil(0.65 * H)).some(v => v > 40);
    return black(0, 0.2) && black(0.8, 1) && mid;
  }

  function pollOrientation() {
    if (!screenEl || samplingBroken || opts.orientation !== 'auto' || !opts.enabled || document.hidden) return;
    if (screenEl.offsetWidth > screenEl.offsetHeight) return;
    let v;
    try {
      v = sampleCroppedLandscape(screenEl);
    } catch {
      samplingBroken = true; // 跨域污染等：放弃自动检测，用 popup 手动设置
      return;
    }
    // 连续两次一致才切换，避免过渡帧抖动
    if (v !== croppedLandscape) {
      if (pendingCropped === v) {
        croppedLandscape = v;
        pendingCropped = null;
        schedule();
      } else pendingCropped = v;
    } else pendingCropped = null;
  }

  // ---------- 绘制 ----------
  function svgEl(tag, attrs) {
    const e = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function roundRectPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    return (
      `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}` +
      `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
    );
  }

  function notchPath(x, y, w, h, r, e) {
    // 刘海：顶边两侧反向圆角 e，下沿圆角 r
    return (
      `M${x - e} ${y}A${e} ${e} 0 0 1 ${x} ${y + e}V${y + h - r}A${r} ${r} 0 0 0 ${x + r} ${y + h}` +
      `H${x + w - r}A${r} ${r} 0 0 0 ${x + w} ${y + h - r}V${y + e}A${e} ${e} 0 0 1 ${x + w + e} ${y}Z`
    );
  }

  function cutoutShape(c, k) {
    if (c.type === 'island') {
      return svgEl('rect', { x: c.x * k, y: c.y * k, width: c.w * k, height: c.h * k, rx: c.r * k, ry: c.r * k });
    }
    if (c.type === 'notch') {
      return svgEl('path', { d: notchPath(c.x * k, c.y * k, c.w * k, c.h * k, c.r * k, (c.ear || 0) * k) });
    }
    if (c.type === 'punch') {
      return svgEl('circle', { cx: c.cx * k, cy: c.cy * k, r: (c.d / 2) * k });
    }
    return null;
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'df-notch-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText =
      'position:absolute;pointer-events:none;z-index:4;overflow:hidden;margin:0;padding:0;border:0;contain:strict;';
    const svg = svgEl('svg', { style: 'position:absolute;left:0;top:0;pointer-events:none;overflow:visible' });
    const badge = document.createElement('div');
    badge.style.cssText =
      'position:absolute;left:50%;top:12%;transform:translateX(-50%);max-width:86%;padding:4px 8px;border-radius:6px;' +
      'background:rgba(0,0,0,.65);color:#fff;font:12px/1.4 system-ui,sans-serif;text-align:center;pointer-events:none;display:none;';
    overlay.append(svg, badge);
    return overlay;
  }

  function setStyle(el, props) {
    for (const k in props) if (el.style[k] !== props[k]) el.style[k] = props[k];
  }

  function hideOverlay() {
    if (overlay && overlay.style.display !== 'none') overlay.style.display = 'none';
  }

  function render() {
    raf = 0;
    if (!alive()) return teardown();
    const el = findScreen();
    screenEl = el;
    if (ro && el !== observedEl) {
      // 跟随画面元素尺寸变化（平移由挂载在 wrapper 内自动跟随）
      if (observedEl) ro.unobserve(observedEl);
      if (el) ro.observe(el);
      observedEl = el;
    }
    const raw = el ? modelText(el) : null;
    const detected = raw ? findDevice(raw) : null;
    const key = manualDevice || detected;
    const dev = key ? DEVICES[key] : null;
    const host = el?.offsetParent;

    let status = 'no-screen';
    if (el && host) status = dev ? 'ok' : 'no-device';

    if (status === 'no-screen' || !opts.enabled) {
      hideOverlay();
      report({ status: opts.enabled ? status : 'disabled', detected, raw, key });
      return;
    }

    const ov = ensureOverlay();
    if (ov.parentNode !== host) host.appendChild(ov); // React 重渲染丢失后也会重新挂上
    const box = contentBox(el, host);
    setStyle(ov, {
      display: 'block',
      left: box.left + 'px',
      top: box.top + 'px',
      width: box.width + 'px',
      height: box.height + 'px'
    });

    const [svg, badge] = ov.children;
    const W = box.width;
    const H = box.height;
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    while (svg.firstChild) svg.firstChild.remove();

    let orientation = 'portrait';
    let badgeText = '';
    if (status === 'no-device') {
      badgeText = raw ? `未收录机型：${raw}（目前只支持 iPhone），点插件图标手动选择` : '未识别机型，点插件图标手动选择';
    } else {
      const o = opts.orientation;
      const wide = W > H;
      if (o === 'portrait') orientation = 'portrait';
      else if (wide) orientation = o === 'landscape-right' ? 'landscape-right' : 'landscape-left';
      else if (o !== 'auto' || croppedLandscape) orientation = 'cropped';
      if (orientation === 'cropped') {
        badgeText = '横屏：控制台把横屏画面裁成竖屏框，刘海/岛所在边缘不在可见区域';
        status = 'landscape-cropped';
      }
    }

    if (dev && orientation !== 'cropped') {
      const landscape = orientation !== 'portrait';
      const Wp = landscape ? H : W; // 竖屏坐标系下的宽高
      const Hp = landscape ? W : H;
      const k = Wp / dev.w;
      const g = svgEl('g', {});
      if (orientation === 'landscape-left') g.setAttribute('transform', `matrix(0 -1 1 0 0 ${Wp})`);
      if (orientation === 'landscape-right') g.setAttribute('transform', `matrix(0 1 -1 0 ${Hp} 0)`);
      if (opts.showCorners && dev.radius > 0) {
        const fill = opts.cornerColor === 'bezel' ? BEZEL_COLOR : '#000';
        g.appendChild(
          svgEl('path', {
            d: `M0 0H${Wp}V${Hp}H0Z` + roundRectPath(0, 0, Wp, Hp, dev.radius * k),
            fill,
            'fill-rule': 'evenodd',
            'data-part': 'corners'
          })
        );
      }
      const shape = cutoutShape(dev.cutout, k);
      if (shape) {
        shape.setAttribute('fill', '#000');
        shape.setAttribute('fill-opacity', String(opts.opacity));
        shape.setAttribute('data-part', 'cutout');
        g.appendChild(shape);
      }
      svg.appendChild(g);
    }

    badge.textContent = badgeText;
    badge.style.display = badgeText ? 'block' : 'none';
    ov.dataset.device = key || '';
    ov.dataset.status = status;
    ov.dataset.orientation = orientation;
    report({ status, detected, raw, key });
  }

  function report(r) {
    const s = JSON.stringify(r);
    if (s === lastReport) return;
    lastReport = s;
    send({ type: 'report', report: r });
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(render);
  }

  // ---------- 状态 ----------
  function applyOpts(o) {
    opts = { ...DEFAULT_OPTS, ...(o || {}) };
    croppedLandscape = false;
    pendingCropped = null;
    schedule();
  }

  let mo = null;
  let ro = null;
  let timer = 0;
  let observedEl = null;

  function teardown() {
    mo?.disconnect();
    ro?.disconnect();
    clearInterval(timer);
    overlay?.remove();
  }

  function start() {
    mo = new MutationObserver(records => {
      // 忽略 overlay 自身的变化，避免自激
      if (records.every(r => overlay && overlay.contains(r.target))) return;
      schedule();
    });
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'aria-label', 'width', 'height']
    });
    ro = new ResizeObserver(schedule);
    addEventListener('resize', schedule);
    addEventListener('hashchange', schedule);
    timer = setInterval(pollOrientation, 1000);

    chrome.storage.local.get('opts').then(r => applyOpts(r.opts), () => applyOpts());
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.opts) applyOpts(changes.opts.newValue);
    });
    chrome.runtime.onMessage.addListener(msg => {
      if (msg?.type === 'tab-state') {
        manualDevice = msg.manualDevice || null;
        schedule();
      }
    });
    send({ type: 'get-tab-state' }).then(st => {
      manualDevice = st?.manualDevice || null;
      schedule();
    });
    schedule();
  }

  start();
})();
