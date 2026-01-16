export function isYouTubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return hostname === 'youtube.com' ||
           hostname === 'www.youtube.com' ||
           hostname === 'youtu.be';
  } catch {
    return false;
  }
}

/**
 * Normalizes a YouTube URL to the standard format: https://www.youtube.com/watch?v=VIDEO_ID
 * Handles various YouTube URL formats:
 * - Short URLs: https://youtu.be/VIDEO_ID
 * - Full URLs: https://www.youtube.com/watch?v=VIDEO_ID
 * - URLs without www: https://youtube.com/watch?v=VIDEO_ID
 * - URLs with additional parameters
 *
 * @param url - The YouTube URL to normalize
 * @returns The normalized YouTube URL in the format https://www.youtube.com/watch?v=VIDEO_ID
 * @throws {Error} If the URL is not a valid YouTube URL
 */
export function normalizeYouTubeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    let videoId: string | undefined;

    // Extract video ID based on URL format
    if (hostname === 'youtu.be') {
      // Short URL format: https://youtu.be/VIDEO_ID
      videoId = parsed.pathname.replace(/^\//, '');
    } else if (hostname === 'youtube.com' || hostname === 'www.youtube.com') {
      // Full URL format: https://www.youtube.com/watch?v=VIDEO_ID
      videoId = parsed.searchParams.get('v') || undefined;
    }

    if (!videoId) {
      throw new Error('Could not extract video ID from URL');
    }

    // Build normalized URL
    const normalizedUrl = new URL('https://www.youtube.com/watch');
    normalizedUrl.searchParams.set('v', videoId);

    // Preserve any additional query parameters (except 'v' for youtu.be URLs)
    for (const [key, value] of parsed.searchParams.entries()) {
      if (key !== 'v') {
        normalizedUrl.searchParams.set(key, value);
      }
    }

    return normalizedUrl.toString();
  } catch {
    throw new Error(`Invalid YouTube URL: ${url}`);
  }
}