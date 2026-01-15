export interface ChromeTab {
  id: number;
  title: string;
  url: string;
  favIconUrl?: string;
}

export interface DomainGroup {
  domain: string;
  tabs: ChromeTab[];
  favicon?: string;
}

export interface ExtractedData {
  id: number;
  title: string;
  url: string;
  timestamp: string;
  html: string;
}

export interface ExtractionResult {
  html: string;
  title: string;
  url: string;
}
