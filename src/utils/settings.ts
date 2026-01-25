const CLOSE_TABS_KEY = "mimir_close_tabs_enabled";
const DEFAULT_CLOSE_TABS = false;

const SUBTITLE_FORMAT_KEY = "mimir_subtitle_format";
const DEFAULT_SUBTITLE_FORMAT = "json";

export type SubtitleFormat = "json" | "vtt" | "text";

export async function getCloseTabsSetting(): Promise<boolean> {
	try {
		const result = await chrome.storage.local.get([CLOSE_TABS_KEY]);
		const value = result[CLOSE_TABS_KEY];
		return typeof value === "boolean" ? value : DEFAULT_CLOSE_TABS;
	} catch (err) {
		console.error("Failed to get close tabs setting:", err);
		return DEFAULT_CLOSE_TABS;
	}
}

export async function setCloseTabsSetting(value: boolean): Promise<void> {
	try {
		await chrome.storage.local.set({ [CLOSE_TABS_KEY]: value });
	} catch (err) {
		console.error("Failed to save close tabs setting:", err);
	}
}

export async function getSubtitleFormatSetting(): Promise<SubtitleFormat> {
	try {
		const result = await chrome.storage.local.get([SUBTITLE_FORMAT_KEY]);
		const value = result[SUBTITLE_FORMAT_KEY];
		if (value === "json" || value === "vtt" || value === "text") {
			return value;
		}
		return DEFAULT_SUBTITLE_FORMAT;
	} catch (err) {
		console.error("Failed to get subtitle format setting:", err);
		return DEFAULT_SUBTITLE_FORMAT;
	}
}

export async function setSubtitleFormatSetting(value: SubtitleFormat): Promise<void> {
	try {
		await chrome.storage.local.set({ [SUBTITLE_FORMAT_KEY]: value });
	} catch (err) {
		console.error("Failed to save subtitle format setting:", err);
	}
}
