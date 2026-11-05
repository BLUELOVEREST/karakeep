import dns from "node:dns/promises";
import type { LookupFunction } from "node:net";
import type { ReadableStreamDefaultReader } from "node:stream/web";
import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch } from "undici";
import type { BodyInit } from "undici";

const messages = {
  INVALID_URL: "Invalid AI endpoint URL.",
  ADDRESS_BLOCKED: "AI endpoint address is blocked.",
  CONNECTION_FAILED: "AI connection failed.",
  TIMEOUT: "AI request timed out.",
  RESPONSE_TOO_LARGE: "AI response is too large.",
  REDIRECT_BLOCKED: "AI redirects are blocked.",
} as const;

export class UserAINetworkError extends Error {
  constructor(public readonly code: keyof typeof messages) {
    super(messages[code]);
    this.name = "UserAINetworkError";
  }
}

function parseUrl(input: string): URL {
  try {
    const url = new URL(input);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      input.includes("#") ||
      /^[a-z][a-z\d+.-]*:[/\\]*[^/\\?#]*@/i.test(
        input.trim().replace(/[\t\r\n]/g, ""),
      ) ||
      /%(?:2f|5c|25)/i.test(url.pathname)
    )
      throw new Error();
    return url;
  } catch {
    throw new UserAINetworkError("INVALID_URL");
  }
}

export function normalizeUserAIBaseUrl(input: string): string {
  const url = parseUrl(input);
  if (input.includes("?")) throw new UserAINetworkError("INVALID_URL");
  return url.toString().replace(/\/+$/, "");
}

function validateAddress(address: string, allowPrivate: boolean): void {
  if (!ipaddr.isValid(address)) throw new UserAINetworkError("ADDRESS_BLOCKED");
  const parsed = ipaddr.process(address);
  const range = parsed.range();
  // Metadata services can also live outside the link-local range.
  const metadata =
    parsed.toString() === "100.100.100.200" ||
    parsed.toString() === "168.63.129.16" ||
    parsed.toString() === "fd00:ec2::254";
  const privateRange = [
    "private",
    "loopback",
    "carrierGradeNat",
    "uniqueLocal",
  ].includes(range);
  if (metadata || (range !== "unicast" && !(allowPrivate && privateRange))) {
    throw new UserAINetworkError("ADDRESS_BLOCKED");
  }
}

export function createUserAIFetch(
  baseUrl: string,
  options: {
    allowedPrivateOrigins?: string[];
    timeoutMs?: number;
    maxResponseBytes?: number;
  } = {},
): typeof globalThis.fetch {
  const base = new URL(normalizeUserAIBaseUrl(baseUrl));
  const prefix = base.pathname.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxResponseBytes = options.maxResponseBytes ?? 8 * 1024 * 1024;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 2_147_483_647 ||
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes <= 0
  ) {
    throw new UserAINetworkError("INVALID_URL");
  }
  const allowPrivate = (options.allowedPrivateOrigins ?? []).some((origin) => {
    const normalized = normalizeUserAIBaseUrl(origin);
    const url = new URL(normalized);
    return normalized === url.origin && url.origin === base.origin;
  });

  return async (input, init) => {
    let agent: Agent | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let request: Request | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const controller = new AbortController();
    let timedOut = false;
    try {
      const url = parseUrl(
        input instanceof Request ? input.url : String(input),
      );
      if (
        url.origin !== base.origin ||
        !(url.pathname === prefix || url.pathname.startsWith(prefix + "/"))
      ) {
        throw new UserAINetworkError("INVALID_URL");
      }
      request = new Request(input, init);
      if (request.headers.has("host"))
        throw new UserAINetworkError("INVALID_URL");
      const aborted = new Promise<never>((_resolve, reject) => {
        onAbort = () => {
          controller.abort();
          reject(
            new UserAINetworkError(timedOut ? "TIMEOUT" : "CONNECTION_FAILED"),
          );
        };
        request!.signal.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(() => {
          timedOut = true;
          onAbort!();
        }, timeoutMs);
        if (request!.signal.aborted) onAbort();
      });
      // Race DNS and each body read too: neither is guaranteed to honor a signal.
      const bounded = <T>(promise: Promise<T>): Promise<T> =>
        Promise.race([promise, aborted]);
      if (request.signal.aborted) await aborted;
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      const addresses = ipaddr.isValid(hostname)
        ? [
            {
              address: hostname,
              family: ipaddr.parse(hostname).kind() === "ipv4" ? 4 : 6,
            },
          ]
        : await bounded(dns.lookup(hostname, { all: true, verbatim: true }));
      if (addresses.length === 0)
        throw new UserAINetworkError("CONNECTION_FAILED");
      addresses.forEach(({ address }) =>
        validateAddress(address, allowPrivate),
      );
      const lookup: LookupFunction = (_hostname, lookupOptions, callback) => {
        const family =
          lookupOptions.family === "IPv4"
            ? 4
            : lookupOptions.family === "IPv6"
              ? 6
              : lookupOptions.family;
        const matching = family
          ? addresses.filter((entry) => entry.family === family)
          : addresses;
        if (!matching.length) {
          callback(new Error("AI connection failed."), "", 4);
        } else if (lookupOptions.all) {
          callback(null, matching);
        } else {
          callback(null, matching[0].address, matching[0].family);
        }
      };
      agent = new Agent({ connect: { lookup } });
      const response = await bounded(
        undiciFetch(url, {
          method: request.method,
          headers: [...request.headers],
          body: request.body as BodyInit | null,
          duplex: "half",
          redirect: "manual",
          dispatcher: agent,
          signal: controller.signal,
        }),
      );
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        void response.body?.cancel().catch(() => undefined);
        throw new UserAINetworkError("REDIRECT_BLOCKED");
      }
      const declaredLength = response.headers.get("content-length");
      if (declaredLength && Number(declaredLength) > maxResponseBytes) {
        void response.body?.cancel().catch(() => undefined);
        throw new UserAINetworkError("RESPONSE_TOO_LARGE");
      }
      reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        while (true) {
          const { done, value } = await bounded(reader.read());
          if (done) break;
          size += value.byteLength;
          if (size > maxResponseBytes)
            throw new UserAINetworkError("RESPONSE_TOO_LARGE");
          chunks.push(value);
        }
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new Response(response.body ? bytes : null, {
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers],
      });
    } catch (error) {
      if (error instanceof UserAINetworkError) throw error;
      throw new UserAINetworkError(timedOut ? "TIMEOUT" : "CONNECTION_FAILED");
    } finally {
      if (timer) clearTimeout(timer);
      if (request && onAbort)
        request.signal.removeEventListener("abort", onAbort);
      controller.abort();
      void reader?.cancel().catch(() => undefined);
      await agent?.destroy().catch(() => undefined);
    }
  };
}
