import { Check } from "lucide-react";
import type { SubtitleFormat } from "../utils/settings";

interface SubtitleFormatOption {
	value: SubtitleFormat;
	label: string;
	description: string;
}

const FORMAT_OPTIONS: SubtitleFormatOption[] = [
	{
		value: "json",
		label: "JSON",
		description: "Structured with timestamps",
	},
	{
		value: "vtt",
		label: "WebVTT",
		description: "Video player compatible",
	},
	{
		value: "text",
		label: "Plain Text",
		description: "Text only, no timestamps",
	},
];

interface SubtitleFormatSelectorProps {
	format: SubtitleFormat;
	onChange: (format: SubtitleFormat) => void;
}

export function SubtitleFormatSelector({ format, onChange }: SubtitleFormatSelectorProps) {
	return (
		<div className="space-y-2">
			<label className="block text-sm font-medium text-glass-secondary">Subtitle Format</label>
			<div className="flex flex-col gap-2">
				{FORMAT_OPTIONS.map((option) => {
					const isSelected = format === option.value;
					return (
						<button
							key={option.value}
							onClick={() => onChange(option.value)}
							className={`
								flex items-center justify-between p-3 rounded-xl transition-all duration-200 w-full
								${
									isSelected
										? "glass-teal border-teal-400/30 text-white shadow-lg"
										: "glass-medium border-white/5 text-glass-secondary hover:bg-white/5 hover:border-white/20"
								}
							`}
						>
							<div className="flex flex-col items-start gap-0.5">
								<span className="font-medium">{option.label}</span>
								<span className="text-xs opacity-70">{option.description}</span>
							</div>
							{isSelected && <Check className="w-5 h-5 text-teal-300" />}
						</button>
					);
				})}
			</div>
		</div>
	);
}
