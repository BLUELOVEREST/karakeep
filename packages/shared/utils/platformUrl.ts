export interface PlatformAppUrlCandidate {
  platform: "xiaohongshu" | "douyin" | "coolapk";
  appUrl: string;
}

function firstMatch(value: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

export function getPlatformAppUrlCandidate(
  url: string,
): PlatformAppUrlCandidate | null {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }

  const host = parsedUrl.hostname.toLowerCase();
  const pathAndQuery = `${parsedUrl.pathname}${parsedUrl.search}`;

  if (host.endsWith("xiaohongshu.com") || host.endsWith("xhslink.com")) {
    const noteId = firstMatch(pathAndQuery, [
      /\/explore\/([^/?#]+)/,
      /\/discovery\/item\/([^/?#]+)/,
      /[?&]noteId=([^&#]+)/,
      /[?&]note_id=([^&#]+)/,
    ]);
    if (noteId) {
      return {
        platform: "xiaohongshu",
        appUrl: `xhsdiscover://item/${decodeURIComponent(noteId)}`,
      };
    }
  }

  if (host.endsWith("douyin.com")) {
    const videoId = firstMatch(pathAndQuery, [
      /\/video\/([^/?#]+)/,
      /\/note\/([^/?#]+)/,
      /\/share\/video\/([^/?#]+)/,
      /[?&]modal_id=([^&#]+)/,
      /[?&]aweme_id=([^&#]+)/,
    ]);
    if (videoId) {
      return {
        platform: "douyin",
        appUrl: `snssdk1128://aweme/detail/${decodeURIComponent(videoId)}`,
      };
    }
  }

  if (host.endsWith("coolapk.com")) {
    const feedId = firstMatch(pathAndQuery, [
      /\/feed\/([^/?#]+)/,
      /\/feedReply\/([^/?#]+)/,
      /[?&]feedId=([^&#]+)/,
    ]);
    if (feedId) {
      return {
        platform: "coolapk",
        appUrl: `coolmarket://feed/${decodeURIComponent(feedId)}`,
      };
    }
  }

  return null;
}
