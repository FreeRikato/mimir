/**
 * Bug 1.8 (subtitles.ts hasShownBackendUnavailableToast is module-scoped).
 *
 * The flag resets when the side panel is closed and reopened (new module
 * init), and the toast re-fires even if the user already dismissed it.
 * The fix persists the flag in `chrome.storage.session`, which survives
 * MV3 service-worker / panel reloads.
 *
 * The chrome API is injected via `chrome.storage.session.get/set/remove`
 * directly so the helper can be unit-tested with a fake `chrome` global.
 */
const FLAG_KEY = "mimir_backend_unavailable_toast_shown";

export async function loadBackendUnavailableToastFlag(): Promise<boolean> {
	const result = await chrome.storage.session.get([FLAG_KEY]);
	return result[FLAG_KEY] === true;
}

export async function setBackendUnavailableToastFlag(value: boolean): Promise<void> {
	if (value) {
		await chrome.storage.session.set({ [FLAG_KEY]: true });
	} else {
		await chrome.storage.session.remove(FLAG_KEY);
	}
}
