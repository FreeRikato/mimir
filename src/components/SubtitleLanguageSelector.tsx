import { SUBTITLE_LANGUAGE_OPTIONS } from "../utils/settings";

interface SubtitleLanguageSelectorProps {
	language: string;
	onChange: (lang: string) => void;
}

export function SubtitleLanguageSelector({ language, onChange }: SubtitleLanguageSelectorProps) {
	return (
		<div className="space-y-2">
			<label htmlFor="mimir-subtitle-language" className="block text-sm font-medium text-glass-secondary">
				Subtitle Language
			</label>
			<select
				id="mimir-subtitle-language"
				value={language}
				onChange={(e) => onChange(e.target.value)}
				className="
					w-full p-3 rounded-xl appearance-none cursor-pointer
					glass-medium border border-white/5 text-glass-primary
					focus:outline-none focus:border-teal-400/30 focus:ring-2 focus:ring-teal-400/20
					transition-all duration-200 hover:bg-white/5
				"
				style={{
					backgroundImage:
						"url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='%23ffffff80'><path d='M4.427 6.427a.6.6 0 0 1 .849 0L8 9.151l2.724-2.724a.6.6 0 1 1 .849.849l-3.149 3.148a.6.6 0 0 1-.849 0L4.427 7.276a.6.6 0 0 1 0-.849z'/></svg>\")",
					backgroundRepeat: "no-repeat",
					backgroundPosition: "right 1rem center",
					backgroundSize: "0.65rem",
					paddingRight: "2.5rem",
				}}
			>
				{SUBTITLE_LANGUAGE_OPTIONS.map((option) => (
					<option key={option.code} value={option.code} className="bg-gray-900 text-white">
						{option.label}
						{option.nativeLabel && option.nativeLabel !== option.label ? ` — ${option.nativeLabel}` : ""}
					</option>
				))}
			</select>
			<p className="text-xs text-glass-muted">Available languages depend on each video. Defaults to English.</p>
		</div>
	);
}
