import * as pdfjsLib from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

export interface PdfJsExtractionResult {
	text: string;
	pageCount: number;
	isScanned: boolean;
}

let workerConfigured = false;

function ensureWorker() {
	if (workerConfigured) return;
	// Serve the worker from the extension's own origin to satisfy CSP.
	// chrome.runtime.getURL is available in any extension context (side panel, popup, etc.)
	pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("assets/pdf.worker.mjs");
	workerConfigured = true;
}

export async function extractTextFromBuffer(buffer: ArrayBuffer): Promise<PdfJsExtractionResult> {
	ensureWorker();

	// Transfer ownership to PDF.js to avoid copying the data
	const data = new Uint8Array(buffer);
	const loadingTask = pdfjsLib.getDocument({ data, verbosity: 0 });
	const pdf = await loadingTask.promise;

	const pageCount = pdf.numPages;
	const pageParts: string[] = [];

	for (let i = 1; i <= pageCount; i++) {
		const page = await pdf.getPage(i);
		const content = await page.getTextContent();
		const pageText = content.items
			.filter((item): item is TextItem => "str" in item)
			.map((item) => item.str)
			.join(" ")
			.replace(/\s+/g, " ")
			.trim();
		pageParts.push(pageText);
	}

	const text = pageParts.map((t, i) => `--- Page ${i + 1} ---\n\n${t}`).join("\n\n");

	// Heuristic: if average chars per page is very low the PDF is likely scanned/image-only
	const totalChars = pageParts.reduce((sum, t) => sum + t.length, 0);
	const isScanned = pageCount > 0 && totalChars / pageCount < 50;

	return { text: text.trim(), pageCount, isScanned };
}

export async function extractTextFromFile(file: File): Promise<PdfJsExtractionResult> {
	const buffer = await file.arrayBuffer();
	return extractTextFromBuffer(buffer);
}
