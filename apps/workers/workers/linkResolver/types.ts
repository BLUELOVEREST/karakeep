export type LinkResolverFallbackPolicy = "fallback_to_generic" | "fail_fast";

export interface LinkResolverInput {
  url: string;
  userId: string;
  jobId: string;
  bookmarkId: string;
  abortSignal: AbortSignal;
}

export interface ResolvedLinkContent {
  title?: string | null;
  description?: string | null;
  author?: string | null;
  publisher?: string | null;
  datePublished?: Date | null;
  dateModified?: Date | null;
  imageUrl?: string | null;
  favicon?: string | null;
  htmlContent?: string | null;
  finalUrl?: string | null;
  archivableAssets?: ResolvedLinkAsset[];
}

export interface ResolvedLinkAsset {
  kind: "image";
  url?: string | null;
  path?: string | null;
  originalUrl?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  role?: "cover" | "content" | null;
}

export type LinkResolverResult =
  | {
      status: "success";
      content: ResolvedLinkContent;
    }
  | {
      status: "fallback";
      reason: string;
    }
  | {
      status: "failure";
      retryable: boolean;
      reason: string;
    };

export interface LinkResolverProvider {
  id: string;
  fallbackPolicy: LinkResolverFallbackPolicy;
  canResolve(url: URL): boolean;
  resolve(input: LinkResolverInput): Promise<LinkResolverResult>;
}
