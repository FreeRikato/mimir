/**
 * Function to be injected into pages to extract their HTML content
 * This runs in the context of the target page, not the extension
 */
export function getPageHTML() {
  return {
    html: document.documentElement.outerHTML,
    title: document.title,
    url: window.location.href,
  };
}
