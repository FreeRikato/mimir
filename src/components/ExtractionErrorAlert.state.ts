/**
 * Pure logic for `ExtractionErrorAlert`. Bug 1.5:
 *   The component truncated to 3 visible errors with "and N more", but
 *   provided no way to inspect the rest. The fix lets the user expand /
 *   collapse the list. This helper owns the collapse/expand state and
 *   exposes what the UI should render.
 */
import type { ExtractionErrorInfo } from "../types";

export const ERROR_ALERT_VISIBLE_LIMIT = 3;

export interface ErrorAlertRenderModel {
	visible: ExtractionErrorInfo[];
	hiddenCount: number;
	canExpand: boolean;
}

/** Decide which errors are visible at the current expand/collapse state. */
export function computeErrorAlertRenderModel(errors: ExtractionErrorInfo[], expanded: boolean): ErrorAlertRenderModel {
	if (expanded || errors.length <= ERROR_ALERT_VISIBLE_LIMIT) {
		return { visible: errors, hiddenCount: 0, canExpand: false };
	}
	return {
		visible: errors.slice(0, ERROR_ALERT_VISIBLE_LIMIT),
		hiddenCount: errors.length - ERROR_ALERT_VISIBLE_LIMIT,
		canExpand: true,
	};
}
