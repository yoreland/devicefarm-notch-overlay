// 按 tab 保存：内容脚本上报的识别结果 + popup 里的手动机型选择（chrome.storage.session，浏览器关闭即清空）
const key = tabId => `tab:${tabId}`;

async function getTab(tabId) {
  return (await chrome.storage.session.get(key(tabId)))[key(tabId)] || {};
}

function updateBadge(tabId, st) {
  const status = st.report?.status;
  const text = status === 'no-device' ? '?' : status === 'landscape-cropped' ? '横' : '';
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = msg.tabId ?? sender.tab?.id;
  if (tabId == null) return false;
  (async () => {
    const st = await getTab(tabId);
    if (msg.type === 'get-tab-state') return reply(st);
    if (msg.type === 'report') st.report = msg.report;
    if (msg.type === 'set-tab-state') {
      st.manualDevice = msg.manualDevice || null;
      chrome.tabs.sendMessage(tabId, { type: 'tab-state', manualDevice: st.manualDevice }).catch(() => {});
    }
    await chrome.storage.session.set({ [key(tabId)]: st });
    updateBadge(tabId, st);
    reply(st);
  })();
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => chrome.storage.session.remove(key(tabId)));
