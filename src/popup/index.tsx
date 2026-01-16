import React from 'react'
import ReactDOM from 'react-dom/client'
import { Toaster } from 'react-hot-toast'
import App from '../App'
import '../index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <Toaster
      position="top-right"
      toastOptions={{
        className: 'glass-medium text-white',
        style: {
          background: 'rgba(30, 41, 59, 0.8)',
          backdropFilter: 'blur(12px)',
          borderRadius: '8px',
          padding: '12px 16px',
          fontSize: '14px',
        },
        success: {
          duration: 3000,
        },
        error: {
          duration: 5000,
        },
        loading: {
          duration: Infinity,
        },
      }}
    />
  </React.StrictMode>,
)
