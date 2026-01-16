export function getPageHTML() {
  return {
    text: document.body.innerText,
    title: document.title,
    url: window.location.href,
  };
}
