// Background script for Autoply Copilot
// Detects job boards and enables the side panel on supported pages
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Error setting panel behavior:', error));
}

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
  'bamboohr.com'
];

async function updateSidePanelForTab(tabId: number, url: string): Promise<void> {
  if (!chrome.sidePanel) {
    return;
  }

  const isJobBoard = JOB_BOARD_URLS.some((jobBoardUrl) => url.includes(jobBoardUrl));

  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'sidepanel.html',
      enabled: isJobBoard,
    });
  } catch (error) {
    console.error('Error setting side panel options:', error);
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    void updateSidePanelForTab(tabId, tab.url);
  }
});

// Listener for messages from content scripts or sidepanel
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'CHECK_CONNECTION') {
    fetch(`${__API_BASE__}/health`)
      .then(res => res.json())
      .then(data => sendResponse({ connected: true, data }))
      .catch(() => sendResponse({ connected: false }));
    return true; // Keep channel open
  }
});
