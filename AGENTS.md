# Mimir Chrome Extension - Agent Guidelines

## Development Commands

### Essential Commands
- `npm run dev` - Start Vite dev server with hot reload
- `npm run build` - TypeScript type check + production build
- `npm run lint` - Run ESLint on all TypeScript/TSX files
- `npm run preview` - Preview production build locally

### Testing
**No test framework currently configured.** Consider adding Vitest + React Testing Library for testing.

## Code Style Guidelines

### Import Organization
Order: External libraries → Type imports → Local components → CSS (entry points only)
```typescript
// src/components/TabItem.tsx
import { useCallback } from 'react';
import { Globe } from 'lucide-react';
import type { ChromeTab } from '../types';
import { Checkbox } from './Checkbox';
import '../index.css';
```

### Naming Conventions
- **Functions**: `camelCase` with descriptive verbs (`extractDomain`, `fetchTabs`)
- **Constants**: `SCREAMING_SNAKE_CASE` (`CACHE_KEY`, `CACHE_TTL`)
- **Types/Interfaces**: `PascalCase` (`ChromeTab`, `DomainGroup`)
- **Components**: `PascalCase` (`TabItem`, `DomainGroup`)
- **Hooks**: `camelCase` with `use` prefix (`useTabs`, `useSelection`)
- **Handlers**: `handle` prefix (`handleTabClick`, `handleCheckboxClick`)

### Error Handling Patterns
```typescript
// src/utils/subtitles.ts:32-47
// Validation with early throw
if (!isYouTubeUrl(youtubeUrl)) {
  throw new Error('Invalid YouTube URL');
}

// src/hooks/useTabs.ts:66-68
// Async operations with user-friendly errors
try {
  const tabs = await chrome.tabs.query({});
} catch (err) {
  setError(err instanceof Error ? err.message : 'Failed to fetch tabs');
}

// src/utils/domainHelpers.ts:7-12
// Fallback for non-critical operations
try {
  const hostname = new URL(url).hostname;
  return hostname.replace(/^www\./, '');
} catch {
  return 'unknown';
}

// Non-critical failures logged with console.warn
try {
  await chrome.storage.session.get([CACHE_KEY]);
} catch (err) {
  console.warn('Failed to load from cache:', err);
}
```

### Type Definitions
Centralize types in `src/types/index.ts`. Use interfaces for data models.
```typescript
export interface ChromeTab {
  id: number;
  windowId: number;
  title: string;
  url: string;
  favIconUrl?: string;
}

export interface DomainGroup {
  domain: string;
  tabs: ChromeTab[];
  favicon?: string;
}
```

### React Patterns
- Functional components with TypeScript props interfaces
- `useCallback` for event handlers with proper dependency arrays
- Custom hooks for shared state logic
- Props interfaces co-located with components
```typescript
// src/components/TabItem.tsx:6-21
interface TabItemProps {
  tab: ChromeTab;
  isSelected: boolean;
  onToggle: () => void;
}

export function TabItem({ tab, isSelected, onToggle }: TabItemProps) {
  const handleTabClick = useCallback(() => {
    chrome.tabs.update(tab.id, { active: true });
  }, [tab.id]);
}
```

### File Organization
```
src/
├── components/     # Reusable UI components (TabItem.tsx, Checkbox.tsx, DomainGroup.tsx)
├── hooks/          # Custom React hooks (useTabs.ts, useSelection.ts)
├── utils/          # Pure utility functions (domainHelpers.ts, subtitles.ts, youtube.ts, scripting.ts)
├── types/          # TypeScript definitions (index.ts)
├── content/        # Content scripts (index.ts)
├── background/     # Service worker (index.ts)
├── popup/          # Popup entry point (index.tsx, index.html)
└── sidepanel/      # Side panel entry point (index.tsx, index.html)
```

### Comment Style
- JSDoc for all exported functions
- Inline comments for rationale on complex operations
```typescript
// src/utils/domainHelpers.ts:3-5
/**
 * Extracts the domain from a URL, stripping 'www.' prefix
 */
export function extractDomain(url: string): string { }

// src/hooks/useTabs.ts:37
// Filter valid tabs (must have id and url)
const validTabs = tabs.filter(...);
```

### TypeScript Configuration
- Strict mode enabled
- `noUnusedLocals: true` - Prevents unused variables
- `noUnusedParameters: true` - Prevents unused parameters
- Target: ES2022, Module: ESNext
- Module resolution: bundler
- Chrome types included via `@types/chrome`

## Tech Stack
- **React 19** + TypeScript 5.9
- **Vite 6** with @crxjs/vite-plugin (Chrome Extension bundler)
- **Tailwind CSS 4** with glassmorphism design system
- **Lucide React** for icons
- Chrome Extension Manifest V3

## Architecture Notes
- **Extension Views**: Popup (icon click), Side Panel (main UI), Background Service Worker
- **Content Script**: Injected into pages to extract rendered text via `chrome.scripting`
- **Caching**: Chrome storage.session with 30s TTL for tab data
- **YouTube Support**: External API for subtitle fetching
- **State Management**: Local React state + Chrome storage, no external state library

## Styling Conventions
- Use Tailwind utility classes
- Glassmorphism system: `.glass-heavy`, `.glass-medium`, `.glass-light`, `.glass-hover`
- Dark theme with CSS custom properties
- Conditional class composition with template literals
