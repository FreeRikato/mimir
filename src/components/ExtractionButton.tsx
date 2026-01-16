import { Loader2, Copy, CheckCircle } from 'lucide-react';

interface ExtractionButtonProps {
  selectedCount: number;
  isExtracting: boolean;
  isSuccess: boolean;
  onExtract: () => void;
}

export function ExtractionButton({ 
  selectedCount, 
  isExtracting, 
  isSuccess,
  onExtract 
}: ExtractionButtonProps) {
  const isDisabled = selectedCount === 0 || isExtracting;

  return (
    <button
      onClick={onExtract}
      disabled={isDisabled}
      className={`
        w-full py-3 px-4 rounded-xl font-medium
        flex items-center justify-center gap-2
        transition-all duration-300 transform glass-focus
        ${isDisabled
          ? 'glass-heavy text-glass-muted cursor-not-allowed'
          : isSuccess
            ? 'glass-teal text-teal-300 border border-teal-500/30 hover:scale-[1.02]'
            : 'glass-heavy text-white border border-white/10 hover:scale-[1.02]'
        }
      `}
    >
      {isExtracting ? (
        <>
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Extracting...</span>
        </>
      ) : isSuccess ? (
        <>
          <CheckCircle className="w-5 h-5" />
          <span>Copied to Clipboard!</span>
        </>
      ) : selectedCount === 0 ? (
        <span>Select tabs to extract</span>
      ) : (
        <>
          <Copy className="w-5 h-5" />
          <span>Copy {selectedCount} {selectedCount === 1 ? 'Item' : 'Items'} as JSON</span>
        </>
      )}
    </button>
  );
}
