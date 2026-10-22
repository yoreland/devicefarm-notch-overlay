const DEFAULT_OPTS = { enabled: true, showCorners: false, cornerColor: 'black', opacity: 1, orientation: 'auto' };
const $ = id => document.getElementById(id);
const STATUS_TEXT = {
  ok: '已叠加',
  'no-device': '未识别机型，请手动选择',
  'no-screen': '当前页面没有已连接的设备画面',
  'landscape-cropped': '横屏（控制台裁剪了画面，刘海不可见）',
  disabled: '已停用'
};

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id;

  const sel = $('device');
  for (const [key, d] of Object.entries(DF_DEVICES)) sel.add(new Option(d.label, key));

  const { opts: stored } = await chrome.storage.local.get('opts');
  const opts = { ...DEFAULT_OPTS, ...(stored || {}) };
  $('enabled').checked = opts.enabled;
  $('showCorners').checked = opts.showCorners;
  $('cornerColor').value = opts.cornerColor;
  $('opacity').value = opts.opacity;
  $('orientation').value = opts.orientation;

  const st = tabId != null ? await chrome.runtime.sendMessage({ type: 'get-tab-state', tabId }) : {};
  sel.value = st?.manualDevice || '';
  const r = st?.report;
  $('status').textContent = r
    ? `${STATUS_TEXT[r.status] || r.status}｜页面型号：${r.raw || '—'}｜使用：${DF_DEVICES[r.key]?.label || '—'}`
    : '当前页面未注入（只在 us-west-2 Device Farm 控制台生效）';

  const save = () => {
    const next = {
      enabled: $('enabled').checked,
      showCorners: $('showCorners').checked,
      cornerColor: $('cornerColor').value,
      opacity: Number($('opacity').value),
      orientation: $('orientation').value
    };
    chrome.storage.local.set({ opts: next });
  };
  for (const id of ['enabled', 'showCorners', 'cornerColor', 'opacity', 'orientation']) $(id).addEventListener('change', save);
  sel.addEventListener('change', () => {
    if (tabId != null) chrome.runtime.sendMessage({ type: 'set-tab-state', tabId, manualDevice: sel.value || null });
  });
})();
