# Manifest host_permissions — justification

`manifest.json` declares:

```json
"host_permissions": [
    "<all_urls>",
    "http://localhost/*",
    "http://127.0.0.1/*",
    "https://localhost/*",
    "https://127.0.0.1/*"
]
```

## Why `<all_urls>` is intentional

The background service worker (`src/background/index.ts`) is an explicit
URL proxy for the side panel:

- `FETCH_SUBTITLES` — forwards the configured YouTube subtitle backend URL.
- `FETCH_PDF_BYTES` — fetches the user-supplied PDF URL (the page they
  clicked Extract on).
- `EXTRACT_PDF` — same as above for the upload path.

The side panel cannot call these URLs directly because of CORS. The
extension therefore forwards arbitrary user-supplied URLs through the
SW under the extension's privileged origin. Without `<all_urls>` the
PDF/HTML extraction paths break for any user-visible URL.

The dev-loopback entries cover the local FastAPI backend configured via
`VITE_SUBTITLES_BASE_URL` for subtitle extraction.

## Mitigations already in place

- The SW reads the configured backend URL from settings; the subtitle
  call is gated on that.
- The side panel never reads arbitrary URLs from the web; the user
  picks tabs by clicking Chrome's tab bar, then explicitly invokes
  Extract.
- The 10MB cap on extracted content and the 5-minute TTL keep the
  storage surface bounded.
- Future work: move the proxy behind an `optional_host_permissions`
  model so the user grants the URL at first use, replacing `<all_urls>`.
  See issue tracker.
