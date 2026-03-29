// Background script for Autoply Copilot (Firefox compatible)
// Detects job boards and manages the extension popup

const JOB_BOARD_URLS = [
  'greenhouse.io',
  'lever.co',
  'linkedin.com/jobs',
  'ashbyhq.com',
  'smartrecruiters.com',
  'jobvite.com',
  'myworkdayjobs.com',
  'teamtailor.com',
  'pinpointhq.com',
  'bamboohr.com',
];

// Helper to check if running in Firefox
declare const browser: typeof chrome;

const isFirefox =
  typeof browser !== 'undefined' && !chrome.runtime?.getManifest?.().manifest_version;

// For Chrome: Set up side panel
if (!isFirefox && chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Error setting panel behavior:', error));
}

// For Firefox: Use browser action popup instead
async function updateBadgeForTab(tabId: number, url: string): Promise<void> {
  if (!url) return;

  const isJobBoard = JOB_BOARD_URLS.some((jobBoardUrl) => url.includes(jobBoardUrl));

  const setBadge = (text: string, color: string) => {
    if (isFirefox) {
      browser.action.setBadgeText({ text, tabId }).catch(() => {});
      browser.action.setBadgeBackgroundColor({ color, tabId }).catch(() => {});
    } else {
      chrome.action.setBadgeText({ text, tabId }).catch(() => {});
      chrome.action.setBadgeBackgroundColor({ color, tabId }).catch(() => {});
    }
  };

  if (isJobBoard) {
    setBadge('✓', '#002e5d');
  } else {
    setBadge('', '');
  }
}

// Listen for tab updates
const onTabUpdated = isFirefox ? browser.tabs.onUpdated : chrome.tabs.onUpdated;

onTabUpdated.addListener(
  (tabId: number, changeInfo: { status?: string }, tab: { url?: string }) => {
    if (changeInfo.status === 'complete' && tab.url) {
      void updateBadgeForTab(tabId, tab.url);
    }
  }
);

// Listener for messages from content scripts or popup
const onMessage = isFirefox ? browser.runtime.onMessage : chrome.runtime.onMessage;

onMessage.addListener(
  (
    message: { type?: string },
    sender: { tab?: { url?: string } },
    sendResponse: (response?: unknown) => void
  ) => {
    if (message.type === 'CHECK_CONNECTION') {
      fetch(`${__API_BASE__}/health`)
        .then((res: Response) => res.json())
        .then((data) => sendResponse({ connected: true, data }))
        .catch(() => sendResponse({ connected: false }));
      return true; // Keep channel open
    }

    if (message.type === 'GET_JOB_BOARD_STATUS') {
      const tabUrl = sender.tab?.url;
      if (tabUrl) {
        const isJobBoard = JOB_BOARD_URLS.some((jobBoardUrl) => tabUrl.includes(jobBoardUrl));
        sendResponse({ isJobBoard });
      }
      return true;
    }
  }
);

// Initialize badge for existing tabs
if (isFirefox) {
  browser.tabs.query({}).then((tabs: Array<{ url?: string; id?: number }>) => {
    for (const tab of tabs) {
      if (tab.url && tab.id) {
        void updateBadgeForTab(tab.id, tab.url);
      }
    }
  });
} else {
  chrome.tabs.query({}, (tabs: Array<{ url?: string; id?: number }>) => {
    for (const tab of tabs) {
      if (tab.url && tab.id) {
        void updateBadgeForTab(tab.id, tab.url);
      }
    }
  });
}
