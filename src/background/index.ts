console.log('Tab HTML Extractor background service worker loaded')

// Open side panel when extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })

chrome.runtime.onInstalled.addListener(() => {
  console.log('Tab HTML Extractor extension installed')
})

// Handle subtitle fetch requests from side panel
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FETCH_SUBTITLES') {
    console.log('Background: Fetching subtitles from', message.url)

    fetch(message.url)
      .then(async (response) => {
        const data = await response.json()
        console.log('Background: Fetch response status:', response.status)
        if (!response.ok) {
          sendResponse({ success: false, error: data.message || data.detail || `HTTP ${response.status}` })
        } else {
          sendResponse({ success: true, data })
        }
      })
      .catch((err) => {
        console.error('Background: Fetch error:', err)
        sendResponse({ success: false, error: err.message })
      })
    return true // Keep channel open for async response
  }

  console.log('Background: Received message:', message)
  sendResponse({ status: 'received' })
})
