console.log("Mimir content script loaded");

// PDF pages are handled by the background worker + PDF.js pipeline.
// The content script cannot access the native PDF viewer's content, so bail out early.
if (document.contentType === "application/pdf") {
	// Nothing to do — extraction is triggered from the side panel via FETCH_PDF_BYTES.
	throw new Error("Mimir: PDF page, skipping content script injection.");
}

// Content script example: Inject a floating action button
const createActionButton = () => {
	const button = document.createElement("button");
	button.textContent = "Mimir";
	button.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 999999;
    padding: 10px 20px;
    background: rgba(0, 0, 0, 0.9);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    color: white;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    cursor: pointer;
    box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.4);
    transition: all 0.3s ease;
    font-weight: 500;
  `;
	button.onmouseover = () => {
		button.style.transform = "translateY(-2px) scale(1.05)";
		button.style.boxShadow = "0 12px 40px 0 rgba(0, 0, 0, 0.5)";
		button.style.borderColor = "rgba(255, 255, 255, 0.2)";
	};
	button.onmouseout = () => {
		button.style.transform = "translateY(0) scale(1)";
		button.style.boxShadow = "0 8px 32px 0 rgba(0, 0, 0, 0.4)";
		button.style.borderColor = "rgba(255, 255, 255, 0.1)";
	};
	button.onclick = () => {
		console.log("Mimir button clicked");
	};
	document.body.appendChild(button);
};

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", createActionButton);
} else {
	createActionButton();
}
