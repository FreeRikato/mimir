console.log('Mimir content script loaded')

// Content script example: Inject a floating action button
const createActionButton = () => {
  const button = document.createElement('button')
  button.textContent = 'Mimir'
  button.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 999999;
    padding: 10px 20px;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  `
  button.onclick = () => {
    console.log('Mimir button clicked')
  }
  document.body.appendChild(button)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createActionButton)
} else {
  createActionButton()
}
