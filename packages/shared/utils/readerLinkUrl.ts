const ALLOWED_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:", "sms:"]);

export function normalizeReaderLinkUrl(
  url: string,
  baseUrl: string,
): string | null {
  const trimmedUrl = url.trim();
  if (!trimmedUrl || trimmedUrl.startsWith("#")) {
    return null;
  }

  try {
    const parsedUrl = new URL(trimmedUrl, baseUrl);
    if (!ALLOWED_SCHEMES.has(parsedUrl.protocol)) {
      return null;
    }
    return parsedUrl.toString();
  } catch {
    return null;
  }
}
