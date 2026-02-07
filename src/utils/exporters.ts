import type { ExtractedData } from "../types";

/**
 * Sanitize URL for use in href attributes
 * Ensures the URL uses a safe protocol (http, https, mailto, tel)
 * Prevents javascript: and other dangerous protocol attacks
 */
function sanitizeUrl(url: string): string {
	const str = url == null ? "" : String(url);
	try {
		const parsed = new URL(str);
		// Only allow safe protocols
		const safeProtocols = ["http:", "https:", "mailto:", "tel:"];
		if (!safeProtocols.includes(parsed.protocol)) {
			return "#"; // Return safe fallback for dangerous protocols
		}
		return str;
	} catch {
		// Invalid URL, return safe fallback
		return "#";
	}
}

export type ExportFormat = "json" | "markdown" | "text" | "csv" | "html";

export interface ExportOptions {
	format: ExportFormat;
	action: "clipboard" | "file";
	filename?: string;
}

/**
 * Create a valid HTML ID from a string
 * HTML IDs must start with a letter and can only contain letters, digits, hyphens, and underscores
 */
function createHtmlId(input: string): string {
	// Guard against null/undefined input
	if (input == null) {
		return "section";
	}
	const str = String(input);

	return (
		str
			.toLowerCase()
			.replace(/[^a-z0-9]/gi, "-") // Replace non-alphanumeric chars with hyphens
			.replace(/^-+/g, "") // Remove leading hyphens
			.replace(/-+/g, "-") // Replace multiple hyphens with single hyphen
			.replace(/^-/g, "x") // Ensure it doesn't start with a hyphen (prepend 'x' if needed)
			.substring(0, 50) || // Limit length
		"section"
	); // Ensure non-empty result
}

/**
 * Main export function that formats data based on the specified format
 */
export function formatExport(data: ExtractedData[], format: ExportFormat): string {
	// Guard against null/undefined input
	if (!Array.isArray(data)) {
		console.warn("formatExport called with non-array data:", data);
		return JSON.stringify([], null, 2);
	}

	switch (format) {
		case "json":
			return formatAsJSON(data);
		case "markdown":
			return formatAsMarkdown(data);
		case "text":
			return formatAsPlainText(data);
		case "csv":
			return formatAsCSV(data);
		case "html":
			return formatAsHTML(data);
		default:
			return formatAsJSON(data);
	}
}

/**
 * Format as JSON (existing format)
 */
export function formatAsJSON(data: ExtractedData[]): string {
	return JSON.stringify(data, null, 2);
}

/**
 * Format as Markdown with headers by domain and links
 */
export function formatAsMarkdown(data: ExtractedData[]): string {
	if (data.length === 0) return "# No Content\n\nNo tabs were extracted.";

	// Group by domain
	const groupedByDomain = new Map<string, ExtractedData[]>();
	for (const item of data) {
		try {
			const url = new URL(item.url);
			const domain = url.hostname;
			if (!groupedByDomain.has(domain)) {
				groupedByDomain.set(domain, []);
			}
			groupedByDomain.get(domain)?.push(item);
		} catch {
			// Invalid URL, add to "Other" group
			if (!groupedByDomain.has("Other")) {
				groupedByDomain.set("Other", []);
			}
			groupedByDomain.get("Other")?.push(item);
		}
	}

	const timestamp = new Date().toLocaleString();
	let markdown = `# Extracted Content\n\n**Extracted:** ${timestamp}\n**Sources:** ${data.length} tab${data.length !== 1 ? "s" : ""}\n\n`;

	// Table of contents
	markdown += "## Table of Contents\n\n";
	const domains = Array.from(groupedByDomain.keys()).sort();
	for (const domain of domains) {
		const items = groupedByDomain.get(domain) || [];
		markdown += `- [${domain}](#${domain.toLowerCase().replace(/\./g, "-")}) (${items.length})\n`;
	}
	markdown += "\n---\n\n";

	// Content by domain
	for (const domain of domains) {
		const items = groupedByDomain.get(domain) || [];
		markdown += `## ${domain}\n\n`;

		for (const item of items) {
			markdown += `### [${escapeMarkdown(item.title)}](${item.url})\n\n`;
			markdown += `${item.text}\n\n`;
			markdown += `*Extracted: ${new Date(item.timestamp).toLocaleString()}*\n\n`;
			markdown += "---\n\n";
		}
	}

	return markdown;
}

/**
 * Format as plain text without formatting
 */
export function formatAsPlainText(data: ExtractedData[]): string {
	if (data.length === 0) return "No content extracted.";

	const timestamp = new Date().toLocaleString();
	let text = `Extracted Content\n${"=".repeat(50)}\nExtracted: ${timestamp}\nSources: ${data.length} tab(s)\n${"=".repeat(50)}\n\n`;

	for (const item of data) {
		text += `${item.title}\n`;
		text += `${"-".repeat(30)}\n`;
		text += `URL: ${item.url}\n`;
		text += `Extracted: ${new Date(item.timestamp).toLocaleString()}\n\n`;
		text += `${item.text}\n\n`;
		text += `${"=".repeat(50)}\n\n`;
	}

	return text;
}

/**
 * Format as CSV with columns: Domain, Title, URL, Content, Date
 */
export function formatAsCSV(data: ExtractedData[]): string {
	if (data.length === 0) return "Domain,Title,URL,Content,Date\n";

	let csv = "Domain,Title,URL,Content,Date\n";

	for (const item of data) {
		let domain = "Unknown";
		try {
			domain = new URL(item.url).hostname;
		} catch {
			// Use default domain
		}

		const title = escapeCSVField(item.title);
		const url = escapeCSVField(item.url);
		const content = escapeCSVField(item.text);
		const date = new Date(item.timestamp).toISOString();

		csv += `${escapeCSVField(domain)},${title},${url},${content},${date}\n`;
	}

	return csv;
}

/**
 * Format as HTML with styled document
 */
export function formatAsHTML(data: ExtractedData[]): string {
	if (data.length === 0) {
		return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Extracted Content</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; }
    h1 { color: #333; border-bottom: 2px solid #007AFF; padding-bottom: 10px; }
    h2 { color: #555; margin-top: 30px; }
    .meta { color: #666; font-size: 14px; margin-bottom: 20px; }
    .entry { border: 1px solid #e0e0e0; border-radius: 8px; padding: 15px; margin-bottom: 20px; background: #f9f9f9; }
    .entry-title { font-size: 18px; font-weight: 600; margin: 0 0 5px 0; }
    .entry-title a { color: #007AFF; text-decoration: none; }
    .entry-title a:hover { text-decoration: underline; }
    .entry-url { font-size: 12px; color: #888; margin-bottom: 10px; }
    .entry-content { margin-top: 10px; white-space: pre-wrap; color: #333; }
    .entry-date { font-size: 12px; color: #999; margin-top: 10px; }
    .domain-header { background: #007AFF; color: white; padding: 10px 15px; border-radius: 6px; margin: 30px 0 15px 0; }
  </style>
</head>
<body>
  <h1>Extracted Content</h1>
  <div class="meta">
    <p>No content was extracted.</p>
  </div>
</body>
</html>`;
	}

	// Group by domain
	const groupedByDomain = new Map<string, ExtractedData[]>();
	for (const item of data) {
		try {
			const url = new URL(item.url);
			const domain = url.hostname;
			if (!groupedByDomain.has(domain)) {
				groupedByDomain.set(domain, []);
			}
			groupedByDomain.get(domain)?.push(item);
		} catch {
			if (!groupedByDomain.has("Other")) {
				groupedByDomain.set("Other", []);
			}
			groupedByDomain.get("Other")?.push(item);
		}
	}

	const timestamp = new Date().toLocaleString();
	const domains = Array.from(groupedByDomain.keys()).sort();

	let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Extracted Content - ${timestamp}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; line-height: 1.6; background: #f5f5f7; }
    h1 { color: #1d1d1f; border-bottom: 2px solid #007AFF; padding-bottom: 10px; }
    h2 { color: #1d1d1f; margin-top: 30px; }
    .meta { color: #86868b; font-size: 14px; margin-bottom: 20px; }
    .entry { border: 1px solid #d2d2d7; border-radius: 12px; padding: 16px; margin-bottom: 16px; background: #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .entry-title { font-size: 17px; font-weight: 600; margin: 0 0 4px 0; }
    .entry-title a { color: #007AFF; text-decoration: none; }
    .entry-title a:hover { text-decoration: underline; }
    .entry-url { font-size: 12px; color: #86868b; margin-bottom: 10px; word-break: break-all; }
    .entry-content { margin-top: 12px; white-space: pre-wrap; color: #1d1d1f; font-size: 14px; }
    .entry-date { font-size: 12px; color: #86868b; margin-top: 10px; }
    .domain-header { background: linear-gradient(135deg, #007AFF, #5856D6); color: white; padding: 12px 16px; border-radius: 10px; margin: 30px 0 15px 0; font-size: 18px; font-weight: 600; }
    .toc { background: #ffffff; border-radius: 12px; padding: 16px; margin-bottom: 20px; border: 1px solid #d2d2d7; }
    .toc-title { font-weight: 600; margin-bottom: 10px; color: #1d1d1f; }
    .toc-list { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
    .toc-item a { color: #007AFF; text-decoration: none; font-size: 14px; }
    .toc-item a:hover { text-decoration: underline; }
    @media print {
      body { background: white; }
      .entry { box-shadow: none; border: 1px solid #ccc; }
      .domain-header { background: #e0e0e0 !important; color: black !important; -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <h1>Extracted Content</h1>
  <div class="meta">
    <p><strong>Extracted:</strong> ${timestamp}</p>
    <p><strong>Sources:</strong> ${data.length} tab${data.length !== 1 ? "s" : ""}</p>
  </div>

  <div class="toc">
    <div class="toc-title">Table of Contents</div>
    <ul class="toc-list">
`;

	// Table of contents
	for (const domain of domains) {
		const items = groupedByDomain.get(domain) || [];
		const anchorId = createHtmlId(domain);
		html += `      <li class="toc-item"><a href="#${anchorId}">${escapeHTML(domain)}</a> (${items.length})</li>\n`;
	}

	html += "    </ul>\n  </div>\n";

	// Content by domain
	for (const domain of domains) {
		const items = groupedByDomain.get(domain) || [];
		const anchorId = createHtmlId(domain);

		html += `  <div class="domain-header" id="${anchorId}">${escapeHTML(domain)}</div>\n`;

		for (const item of items) {
			const sanitizedUrl = sanitizeUrl(item.url);
			html += `  <div class="entry">
    <div class="entry-title"><a href="${sanitizedUrl}" target="_blank" rel="noopener noreferrer">${escapeHTML(item.title)}</a></div>
    <div class="entry-url">${escapeHTML(item.url)}</div>
    <div class="entry-content">${escapeHTML(item.text)}</div>
    <div class="entry-date">Extracted: ${new Date(item.timestamp).toLocaleString()}</div>
  </div>\n`;
		}
	}

	html += "</body>\n</html>";

	return html;
}

/**
 * Download content as a file
 */
export function downloadAsFile(content: string, filename: string, mimeType: string): void {
	const blob = new Blob([content], { type: mimeType });
	const url = URL.createObjectURL(blob);

	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();

	// Cleanup
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

/**
 * Generate a filename for the export
 */
export function generateFilename(format: ExportFormat, timestamp: Date = new Date()): string {
	const dateStr = timestamp.toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);

	const extensions: Record<ExportFormat, string> = {
		json: "json",
		markdown: "md",
		text: "txt",
		csv: "csv",
		html: "html",
	};

	return `mimir-export_${dateStr}.${extensions[format]}`;
}

/**
 * Get MIME type for the format
 */
export function getMimeType(format: ExportFormat): string {
	const mimeTypes: Record<ExportFormat, string> = {
		json: "application/json",
		markdown: "text/markdown",
		text: "text/plain",
		csv: "text/csv",
		html: "text/html",
	};

	return mimeTypes[format];
}

// Helper functions

function escapeCSVField(value: string): string {
	// Guard against null/undefined input
	const str = value == null ? "" : String(value);

	// If the value contains quotes, commas, or newlines, wrap in quotes and escape internal quotes
	if (str.includes('"') || str.includes(",") || str.includes("\n") || str.includes("\r")) {
		return `"${str.replace(/"/g, '""')}"`;
	}
	return str;
}

function escapeHTML(text: string): string {
	// Guard against null/undefined input
	const str = text == null ? "" : String(text);

	const div = document.createElement("div");
	div.textContent = str;
	return div.innerHTML;
}

function escapeMarkdown(text: string): string {
	// Guard against null/undefined input
	const str = text == null ? "" : String(text);

	// Escape special markdown characters
	return str.replace(/([_*[\]()\\`~#+\-.!|])/g, "\\$1");
}
