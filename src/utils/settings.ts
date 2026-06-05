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

const SUBTITLE_LANGUAGE_KEY = "mimir_subtitle_language";
const DEFAULT_SUBTITLE_LANGUAGE = "en";

export interface SubtitleLanguageOption {
	code: string;
	label: string;
	nativeLabel?: string;
}

export const SUBTITLE_LANGUAGE_OPTIONS: SubtitleLanguageOption[] = [
	{ code: "en", label: "English", nativeLabel: "English" },
	{ code: "es", label: "Spanish", nativeLabel: "Español" },
	{ code: "fr", label: "French", nativeLabel: "Français" },
	{ code: "de", label: "German", nativeLabel: "Deutsch" },
	{ code: "it", label: "Italian", nativeLabel: "Italiano" },
	{ code: "pt", label: "Portuguese", nativeLabel: "Português" },
	{ code: "nl", label: "Dutch", nativeLabel: "Nederlands" },
	{ code: "ru", label: "Russian", nativeLabel: "Русский" },
	{ code: "pl", label: "Polish", nativeLabel: "Polski" },
	{ code: "tr", label: "Turkish", nativeLabel: "Türkçe" },
	{ code: "uk", label: "Ukrainian", nativeLabel: "Українська" },
	{ code: "ar", label: "Arabic", nativeLabel: "العربية" },
	{ code: "he", label: "Hebrew", nativeLabel: "עברית" },
	{ code: "hi", label: "Hindi", nativeLabel: "हिन्दी" },
	{ code: "bn", label: "Bengali", nativeLabel: "বাংলা" },
	{ code: "ta", label: "Tamil", nativeLabel: "தமிழ்" },
	{ code: "te", label: "Telugu", nativeLabel: "తెలుగు" },
	{ code: "id", label: "Indonesian", nativeLabel: "Bahasa Indonesia" },
	{ code: "vi", label: "Vietnamese", nativeLabel: "Tiếng Việt" },
	{ code: "th", label: "Thai", nativeLabel: "ไทย" },
	{ code: "ja", label: "Japanese", nativeLabel: "日本語" },
	{ code: "ko", label: "Korean", nativeLabel: "한국어" },
	{ code: "zh-Hans", label: "Chinese (Simplified)", nativeLabel: "简体中文" },
	{ code: "zh-Hant", label: "Chinese (Traditional)", nativeLabel: "繁體中文" },
];

// ISO 639-1 with optional region: e.g. "en", "en-US", "pt-BR", "zh-Hans"
const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

const KNOWN_LANGUAGE_CODES = new Set(SUBTITLE_LANGUAGE_OPTIONS.map((o) => o.code));

export function isValidLanguageCode(code: string): boolean {
	return typeof code === "string" && LANGUAGE_CODE_PATTERN.test(code);
}

export async function getSubtitleLanguageSetting(): Promise<string> {
	try {
		const result = await chrome.storage.local.get([SUBTITLE_LANGUAGE_KEY]);
		const value = result[SUBTITLE_LANGUAGE_KEY];
		if (typeof value === "string" && (KNOWN_LANGUAGE_CODES.has(value) || isValidLanguageCode(value))) {
			return value;
		}
		return DEFAULT_SUBTITLE_LANGUAGE;
	} catch (err) {
		console.error("Failed to get subtitle language setting:", err);
		return DEFAULT_SUBTITLE_LANGUAGE;
	}
}

export async function setSubtitleLanguageSetting(value: string): Promise<void> {
	try {
		const safeValue = isValidLanguageCode(value) ? value : DEFAULT_SUBTITLE_LANGUAGE;
		await chrome.storage.local.set({ [SUBTITLE_LANGUAGE_KEY]: safeValue });
	} catch (err) {
		console.error("Failed to save subtitle language setting:", err);
	}
}
