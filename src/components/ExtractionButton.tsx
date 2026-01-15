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
        w-full py-3 px-4 rounded-lg font-medium
        flex items-center justify-center gap-2
        transition-all duration-200
        ${isDisabled
          ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
          : isSuccess
            ? 'bg-green-600 hover:bg-green-700 text-white'
            : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/25'
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
