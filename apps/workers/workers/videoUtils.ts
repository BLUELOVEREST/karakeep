import path from "path";

const VIDEO_MP4 = "video/mp4";
const VIDEO_WEBM = "video/webm";
const VIDEO_MKV = "video/x-matroska";
const VIDEO_ASSET_TYPES = new Set([VIDEO_MP4, VIDEO_WEBM, VIDEO_MKV]);

const VIDEO_PLATFORM_HOSTS = new Set([
  "b23.tv",
  "bilibili.com",
  "m.bilibili.com",
  "www.bilibili.com",
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
]);

export function shouldSkipFullPageArchiveForVideoUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return VIDEO_PLATFORM_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

export function getVideoContentTypeForDownloadedFile(
  explicitContentType: string | null | undefined,
  assetPath: string,
): string {
  if (explicitContentType && VIDEO_ASSET_TYPES.has(explicitContentType)) {
    return explicitContentType;
  }

  switch (path.extname(assetPath).toLowerCase()) {
    case ".webm":
      return VIDEO_WEBM;
    case ".mkv":
      return VIDEO_MKV;
    case ".mp4":
    default:
      return VIDEO_MP4;
  }
}
