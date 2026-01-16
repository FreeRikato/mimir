import { useState } from 'react'

function App() {
  const [message] = useState('Hello from Mimir!')

  const testContentScript = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, { action: 'test' }, (response) => {
        console.log('Response:', response)
      })
    }
  }

  return (
    <div className="min-w-[300px] p-4 text-center glass-heavy rounded-xl">
      <h1 className="text-xl font-bold mb-4 text-white">
        Mimir Extension
      </h1>
      <p className="mb-4 text-glass-secondary">{message}</p>
      <button
        onClick={testContentScript}
        className="px-4 py-2 glass-light text-white rounded-lg hover:scale-105 transition-all duration-300 border border-white/10"
      >
        Test Content Script
      </button>
    </div>
  )
}

export default App
