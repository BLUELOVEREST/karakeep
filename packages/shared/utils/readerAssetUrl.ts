function isLoopbackHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1";
}

function normalizeReaderAssetUrl(value: string, appServerUrl: string) {
  let appOrigin: string;
  try {
    appOrigin = new URL(appServerUrl).origin;
  } catch {
    return value;
  }

  if (value.startsWith("file:///api/public/assets/")) {
    return `${appOrigin}${value.slice("file://".length)}`;
  }

  if (value.startsWith("/api/public/assets/")) {
    return `${appOrigin}${value}`;
  }

  try {
    const url = new URL(value);
    if (
      isLoopbackHost(url.hostname) &&
      url.pathname.startsWith("/api/public/assets/")
    ) {
      return `${appOrigin}${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    return value;
  }

  return value;
}

export function normalizeReaderHtmlAssetUrls(
  htmlContent: string,
  appServerUrl: string,
) {
  return htmlContent.replace(
    /\b(src|href)=(["'])(.*?)\2/gi,
    (match, attr: string, quote: string, value: string) => {
      const normalized = normalizeReaderAssetUrl(value, appServerUrl);
      return normalized === value
        ? match
        : `${attr}=${quote}${normalized}${quote}`;
    },
  );
}
