console.log('Tab HTML Extractor background service worker loaded')

// Open side panel when extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })

chrome.runtime.onInstalled.addListener(() => {
  console.log('Tab HTML Extractor extension installed')
})

// Listen for messages from content scripts or side panel
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  console.log('Received message:', request)
  sendResponse({ status: 'received' })
})
