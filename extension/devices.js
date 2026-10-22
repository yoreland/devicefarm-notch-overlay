// iPhone 屏幕几何参数表（竖屏逻辑坐标，单位 pt；数值为公开资料与实机截图对照得到的近似值，误差约 1–3pt）
//   w/h     逻辑分辨率
//   radius  屏幕圆角
//   cutout  { type: 'notch' | 'island' | 'none', x, y, w, h, r }    x/y 为左上角，r 为下沿圆角（岛为胶囊半径）
//           notch 额外可带 ear（刘海两侧与屏幕顶边相接处的反向圆角）
//           { type: 'punch', cx, cy, d }   挖孔扩展点（渲染代码已支持，目前未收录任何 Android 机型）
// 校准：iPhone 16 在 Device Farm 控制台实测（canvas 369.3×800，k≈0.94），岛落在状态栏时间与电池之间。
(() => {
  const NOTCH_X = { w: 375, h: 812, radius: 39, cutout: { type: 'notch', x: 83, y: 0, w: 209, h: 30, r: 20, ear: 6 } };
  const NOTCH_X_MAX = { w: 414, h: 896, radius: 39, cutout: { type: 'notch', x: 102.5, y: 0, w: 209, h: 30, r: 20, ear: 6 } };
  const NOTCH_XR = { w: 414, h: 896, radius: 41.5, cutout: { type: 'notch', x: 91, y: 0, w: 232, h: 33, r: 21, ear: 6 } };
  const NOTCH_12_MINI = { w: 375, h: 812, radius: 44, cutout: { type: 'notch', x: 83, y: 0, w: 209, h: 32, r: 20, ear: 6 } };
  const NOTCH_12 = { w: 390, h: 844, radius: 47.33, cutout: { type: 'notch', x: 90, y: 0, w: 210, h: 32, r: 20, ear: 6 } };
  const NOTCH_12_MAX = { w: 428, h: 926, radius: 53.33, cutout: { type: 'notch', x: 109, y: 0, w: 210, h: 32, r: 20, ear: 6 } };
  const NOTCH_13_MINI = { w: 375, h: 812, radius: 44, cutout: { type: 'notch', x: 95, y: 0, w: 185, h: 34, r: 20, ear: 6 } };
  const NOTCH_13 = { w: 390, h: 844, radius: 47.33, cutout: { type: 'notch', x: 114, y: 0, w: 162, h: 33, r: 20, ear: 6 } };
  const NOTCH_13_MAX = { w: 428, h: 926, radius: 53.33, cutout: { type: 'notch', x: 133, y: 0, w: 162, h: 33, r: 20, ear: 6 } };
  const ISLAND_PRO = { w: 393, h: 852, radius: 55, cutout: { type: 'island', x: 133.5, y: 11, w: 126, h: 37, r: 18.5 } };
  const ISLAND_PRO_MAX = { w: 430, h: 932, radius: 55, cutout: { type: 'island', x: 152, y: 11, w: 126, h: 37, r: 18.5 } };
  const ISLAND_16_PRO = { w: 402, h: 874, radius: 62, cutout: { type: 'island', x: 138, y: 14, w: 126, h: 37, r: 18.5 } };
  const ISLAND_16_PRO_MAX = { w: 440, h: 956, radius: 62, cutout: { type: 'island', x: 157, y: 14, w: 126, h: 37, r: 18.5 } };
  const ISLAND_AIR = { w: 420, h: 912, radius: 60, cutout: { type: 'island', x: 147, y: 14, w: 126, h: 37, r: 18.5 } };
  // iPhone 18 Pro 系列：Apple 称"更小的 Dynamic Island"，未给尺寸。宽度按 Technobezz 实拍测量估算
  // （占屏宽约 21%，≈93pt，比 17 Pro 窄约 24%）；高度未知，暂沿用 37pt，待真机校准。
  const ISLAND_18_PRO = { w: 402, h: 874, radius: 62, cutout: { type: 'island', x: 154.5, y: 14, w: 93, h: 37, r: 18.5 } };
  const ISLAND_18_PRO_MAX = { w: 440, h: 956, radius: 62, cutout: { type: 'island', x: 173.5, y: 14, w: 93, h: 37, r: 18.5 } };
  const NONE_SE = { w: 375, h: 667, radius: 0, cutout: { type: 'none' } };

  const TABLE = [
    // 无刘海（Home 键机型）
    ['iphone se', 'iPhone SE (2/3 代)', NONE_SE],
    ['iphone 8', 'iPhone 8', NONE_SE],
    ['iphone 7', 'iPhone 7', NONE_SE],
    ['iphone 6s', 'iPhone 6s', NONE_SE],
    // 刘海屏
    ['iphone x', 'iPhone X', NOTCH_X],
    ['iphone xs', 'iPhone XS', NOTCH_X],
    ['iphone xs max', 'iPhone XS Max', NOTCH_X_MAX],
    ['iphone xr', 'iPhone XR', NOTCH_XR],
    ['iphone 11', 'iPhone 11', NOTCH_XR],
    ['iphone 11 pro', 'iPhone 11 Pro', NOTCH_X],
    ['iphone 11 pro max', 'iPhone 11 Pro Max', NOTCH_X_MAX],
    ['iphone 12 mini', 'iPhone 12 mini', NOTCH_12_MINI],
    ['iphone 12', 'iPhone 12', NOTCH_12],
    ['iphone 12 pro', 'iPhone 12 Pro', NOTCH_12],
    ['iphone 12 pro max', 'iPhone 12 Pro Max', NOTCH_12_MAX],
    ['iphone 13 mini', 'iPhone 13 mini', NOTCH_13_MINI],
    ['iphone 13', 'iPhone 13', NOTCH_13],
    ['iphone 13 pro', 'iPhone 13 Pro', NOTCH_13],
    ['iphone 13 pro max', 'iPhone 13 Pro Max', NOTCH_13_MAX],
    ['iphone 14', 'iPhone 14', NOTCH_13],
    ['iphone 14 plus', 'iPhone 14 Plus', NOTCH_13_MAX],
    ['iphone 16e', 'iPhone 16e', NOTCH_13],
    // Dynamic Island
    ['iphone 14 pro', 'iPhone 14 Pro', ISLAND_PRO],
    ['iphone 14 pro max', 'iPhone 14 Pro Max', ISLAND_PRO_MAX],
    ['iphone 15', 'iPhone 15', ISLAND_PRO],
    ['iphone 15 plus', 'iPhone 15 Plus', ISLAND_PRO_MAX],
    ['iphone 15 pro', 'iPhone 15 Pro', ISLAND_PRO],
    ['iphone 15 pro max', 'iPhone 15 Pro Max', ISLAND_PRO_MAX],
    ['iphone 16', 'iPhone 16', ISLAND_PRO],
    ['iphone 16 plus', 'iPhone 16 Plus', ISLAND_PRO_MAX],
    ['iphone 16 pro', 'iPhone 16 Pro', ISLAND_16_PRO],
    ['iphone 16 pro max', 'iPhone 16 Pro Max', ISLAND_16_PRO_MAX],
    ['iphone 17', 'iPhone 17', ISLAND_16_PRO],
    ['iphone 17 pro', 'iPhone 17 Pro', ISLAND_16_PRO],
    ['iphone 17 pro max', 'iPhone 17 Pro Max', ISLAND_16_PRO_MAX],
    ['iphone air', 'iPhone Air', ISLAND_AIR],
    ['iphone 18 pro', 'iPhone 18 Pro（岛尺寸为估算）', ISLAND_18_PRO],
    ['iphone 18 pro max', 'iPhone 18 Pro Max（岛尺寸为估算）', ISLAND_18_PRO_MAX]
  ];

  const DEVICES = {};
  for (const [key, label, geo] of TABLE) DEVICES[key] = { label, ...geo };

  function normalize(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/\(.*?\)/g, ' ')
      .replace(/^\s*apple\s+/, '')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // 先精确匹配；否则取"作为前缀且后面是词边界"的最长 key（"iphone 16 pro max" 优先于 "iphone 16"）
  function findDevice(name) {
    const n = normalize(name);
    if (!n) return null;
    if (DEVICES[n]) return n;
    let best = null;
    for (const key of Object.keys(DEVICES)) {
      if (n.startsWith(key + ' ') && (!best || key.length > best.length)) best = key;
    }
    if (best) return best;
    // 表里还没有的新款 iPhone（编号 ≥ 18）：按尺寸档位回退到最新的已收录机型，避免每年发布新机就失效
    const m = n.match(/^iphone (\d+)( .*)?$/);
    if (m && Number(m[1]) >= 18) {
      const big = /\b(max|plus)\b/.test(m[2] || '');
      return big ? 'iphone 18 pro max' : 'iphone 18 pro';
    }
    return null;
  }

  globalThis.DF_DEVICES = DEVICES;
  globalThis.DF_findDevice = findDevice;
})();
