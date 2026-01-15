import { useState } from 'react'
import './App.css'

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
    <div className="min-w-[300px] p-4 text-center">
      <h1 className="text-xl font-bold mb-4">Mimir Extension</h1>
      <p className="mb-4">{message}</p>
      <button
        onClick={testContentScript}
        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
      >
        Test Content Script
      </button>
    </div>
  )
}

export default App
