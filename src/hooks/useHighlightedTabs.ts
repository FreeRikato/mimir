import { useEffect, useState } from "react";
import type { ChromeTab } from "../types";
import { getHighlightedTabs } from "../utils/tabHelpers";

export function useHighlightedTabs() {
	const [highlightedCount, setHighlightedCount] = useState(0);
	const [highlightedTabs, setHighlightedTabs] = useState<ChromeTab[]>([]);

	// Function to fetch and update highlighted tabs
	const fetchHighlightedTabs = async () => {
		const tabs = await getHighlightedTabs();
		setHighlightedTabs(tabs);
		setHighlightedCount(tabs.length);
	};

	// Initial load
	useEffect(() => {
		fetchHighlightedTabs(); // eslint-disable-line react-hooks/set-state-in-effect
	}, []);

	// Listen for highlighted tab changes in Chrome
	useEffect(() => {
		const handleHighlightedChange = () => {
			fetchHighlightedTabs();
		};

		chrome.tabs.onHighlighted.addListener(handleHighlightedChange);

		return () => {
			chrome.tabs.onHighlighted.removeListener(handleHighlightedChange);
		};
	}, []);

	return {
		highlightedCount,
		highlightedTabs,
		updateHighlightedTabs: fetchHighlightedTabs,
	};
}
