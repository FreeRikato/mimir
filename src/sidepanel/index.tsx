import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import { SidePanelApp } from '../SidePanelApp';
import '../index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SidePanelApp />
    <Toaster
      position="top-right"
      toastOptions={{
        className: 'glass-heavy text-white',
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
);
