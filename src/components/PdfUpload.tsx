import { FileUp, X } from "lucide-react";
import { useRef } from "react";

interface PdfUploadProps {
	tabTitle: string;
	tabUrl: string;
	onFileSelected: (file: File) => void;
	onDismiss: () => void;
}

export function PdfUpload({ tabTitle, tabUrl, onFileSelected, onDismiss }: PdfUploadProps) {
	const inputRef = useRef<HTMLInputElement>(null);

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) onFileSelected(file);
	};

	return (
		<div className="glass-heavy border border-amber-500/30 rounded-lg p-3 mb-3">
			<div className="flex items-center justify-between mb-2">
				<div className="flex items-center gap-2 text-amber-300">
					<FileUp className="w-4 h-4" />
					<span className="text-sm font-medium">PDF upload required</span>
				</div>
				<button onClick={onDismiss} className="text-glass-muted hover:text-white">
					<X className="w-4 h-4" />
				</button>
			</div>

			<p className="text-xs text-glass-muted mb-1 truncate" title={tabTitle}>
				{tabTitle}
			</p>
			<p className="text-xs text-glass-muted/60 mb-3 break-all line-clamp-1" title={tabUrl}>
				{tabUrl}
			</p>

			<p className="text-xs text-glass-muted mb-3">
				This PDF can't be fetched automatically (local file or login required). Upload the file to extract its text.
			</p>

			<input ref={inputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={handleChange} />

			<button
				onClick={() => inputRef.current?.click()}
				className="w-full px-3 py-2 text-sm font-medium rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 transition-colors"
			>
				Choose PDF file…
			</button>
		</div>
	);
}
