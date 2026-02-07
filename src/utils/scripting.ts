export function getPageHTML() {
	// Handle cases where document.body might be null (e.g., iframes, not loaded yet, etc.)
	// This prevents DOMException: "The document is empty" or similar errors
	const body = document.body;
	const text = body ? body.innerText : "";

	return {
		text,
		title: document.title || "Untitled",
		url: window.location.href,
	};
}
