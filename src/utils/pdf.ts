import type { PdfCandidate } from "../types";

const CHROME_PDF_VIEWER_EXTENSION_ID = "mhjfbmdgcfjbbpaeojofohoefgiehjai";

function stripHashAndQuery(url: string): string {
	try {
		const parsed = new URL(url);
		parsed.hash = "";
		parsed.search = "";
		return parsed.toString();
	} catch {
		return url;
	}
}

function hasPdfExtension(url: string): boolean {
	const normalized = stripHashAndQuery(url).toLowerCase();
	return normalized.endsWith(".pdf");
}

function getUrlParamAsPdfUrl(url: string, paramName: string): string | null {
	try {
		const parsed = new URL(url);
		const value = parsed.searchParams.get(paramName);
		if (!value) return null;
		const decoded = decodeURIComponent(value);
		return hasPdfExtension(decoded) ? decoded : null;
	} catch {
		return null;
	}
}

export function extractPdfFromChromeViewerUrl(url: string): string | null {
	try {
		const parsed = new URL(url);
		const isChromeViewer =
			parsed.protocol === "chrome-extension:" && parsed.hostname === CHROME_PDF_VIEWER_EXTENSION_ID;
		if (!isChromeViewer) {
			return null;
		}

		return getUrlParamAsPdfUrl(url, "file") || getUrlParamAsPdfUrl(url, "url");
	} catch {
		return null;
	}
}

export function isPdfUrl(url: string): boolean {
	try {
		const parsed = new URL(url);

		if (parsed.protocol === "file:" && hasPdfExtension(url)) {
			return true;
		}

		if ((parsed.protocol === "http:" || parsed.protocol === "https:") && hasPdfExtension(url)) {
			return true;
		}

		if (extractPdfFromChromeViewerUrl(url)) {
			return true;
		}

		return Boolean(getUrlParamAsPdfUrl(url, "file") || getUrlParamAsPdfUrl(url, "url"));
	} catch {
		return false;
	}
}

export function detectPdfCandidate(url: string): PdfCandidate {
	const viewerSource = extractPdfFromChromeViewerUrl(url);
	if (viewerSource) {
		return { isPdf: true, sourceUrl: viewerSource, sourceType: "viewer" };
	}

	try {
		const parsed = new URL(url);
		if (parsed.protocol === "file:" && hasPdfExtension(url)) {
			return { isPdf: true, sourceUrl: url, sourceType: "local" };
		}

		if ((parsed.protocol === "http:" || parsed.protocol === "https:") && isPdfUrl(url)) {
			return { isPdf: true, sourceUrl: url, sourceType: "remote" };
		}
	} catch {
		return { isPdf: false, sourceType: "unknown" };
	}

	return { isPdf: false, sourceType: "unknown" };
}

export function shouldFilterTabUrl(url: string): boolean {
	if (url.startsWith("chrome://") || url.startsWith("edge://") || url.startsWith("about:")) {
		return true;
	}

	if (!url.startsWith("chrome-extension://")) {
		return false;
	}

	return !extractPdfFromChromeViewerUrl(url);
}
