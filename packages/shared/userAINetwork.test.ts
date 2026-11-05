import type { LookupFunction } from "node:net";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface AgentOptions {
  connect: { lookup: LookupFunction };
}

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  fetch: vi.fn(),
  destroy: vi.fn(),
  agents: [] as { options: AgentOptions }[],
}));
vi.mock("node:dns/promises", () => ({ default: { lookup: mocks.lookup } }));
vi.mock("undici", () => ({
  Agent: class {
    constructor(public options: AgentOptions) {
      mocks.agents.push(this);
    }
    destroy = mocks.destroy;
  },
  fetch: mocks.fetch,
}));

import {
  createUserAIFetch,
  normalizeUserAIBaseUrl,
  UserAINetworkError,
} from "./userAINetwork";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.agents.length = 0;
  mocks.destroy.mockResolvedValue(undefined);
  mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  mocks.fetch.mockResolvedValue(new Response("ok"));
});

describe("user AI transport", () => {
  it("normalizes paths and rejects unsafe base URLs with fixed errors", () => {
    expect(normalizeUserAIBaseUrl("https://EXAMPLE.com/api/v1///")).toBe(
      "https://example.com/api/v1",
    );
    for (const url of [
      "file:///tmp/a",
      "https://a:b@example.com",
      "https://example.com/?",
      "https://example.com/#",
      "invalid",
    ]) {
      expect(() => normalizeUserAIBaseUrl(url)).toThrow(UserAINetworkError);
    }
  });
  it("enforces origin and segment-boundary prefix before DNS", async () => {
    const fetch = createUserAIFetch("https://example.com/api");
    for (const url of [
      "https://evil.com/api",
      "https://example.com/apix",
      "https://example.com/api/../outside",
      "https://u:p@example.com/api",
    ]) {
      await expect(fetch(url)).rejects.toMatchObject({ code: "INVALID_URL" });
    }
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "100.64.0.1",
    "169.254.169.254",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:127.0.0.1",
    "224.0.0.1",
    "2002:7f00:1::",
  ])("blocks %s", async (address) => {
    mocks.lookup.mockResolvedValue([
      { address, family: address.includes(":") ? 6 : 4 },
    ]);
    await expect(
      createUserAIFetch("https://example.com")("https://example.com/v1"),
    ).rejects.toMatchObject({ code: "ADDRESS_BLOCKED" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("rejects mixed public/private DNS answers", async () => {
    mocks.lookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);
    await expect(
      createUserAIFetch("https://example.com")("https://example.com"),
    ).rejects.toMatchObject({ code: "ADDRESS_BLOCKED" });
  });
  it("allows private addresses only for the exact origin, never metadata", async () => {
    const fetch = createUserAIFetch("https://example.com", {
      allowedPrivateOrigins: ["https://example.com"],
    });
    mocks.lookup.mockResolvedValue([{ address: "10.0.0.1", family: 4 }]);
    expect(await (await fetch("https://example.com")).text()).toBe("ok");
    for (const address of [
      "169.254.169.254",
      "fe80::1",
      "::ffff:169.254.169.254",
      "100.100.100.200",
      "fd00:ec2::254",
    ]) {
      mocks.lookup.mockResolvedValue([
        { address, family: address.includes(":") ? 6 : 4 },
      ]);
      await expect(fetch("https://example.com")).rejects.toMatchObject({
        code: "ADDRESS_BLOCKED",
      });
    }
  });
  it("pins DNS at socket lookup and overrides dispatcher and redirect options", async () => {
    await createUserAIFetch("https://example.com")("https://example.com", {
      redirect: "follow",
    });
    const lookup = mocks.agents[0].options.connect.lookup;
    const callback = vi.fn();
    lookup("example.com", { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [
      { address: "93.184.216.34", family: 4 },
    ]);
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][1]).toMatchObject({
      redirect: "manual",
      dispatcher: mocks.agents[0],
    });
    expect(mocks.destroy).toHaveBeenCalled();
  });
  it("validates IP literals without DNS", async () => {
    await expect(
      createUserAIFetch("http://[::ffff:127.0.0.1]")(
        "http://[::ffff:127.0.0.1]/",
      ),
    ).rejects.toMatchObject({ code: "ADDRESS_BLOCKED" });
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
  it.each([301, 302, 303, 307, 308])("rejects redirect %s", async (status) => {
    mocks.fetch.mockResolvedValue(
      new Response(null, { status, headers: { location: "http://secret" } }),
    );
    await expect(
      createUserAIFetch("https://example.com")("https://example.com"),
    ).rejects.toMatchObject({ code: "REDIRECT_BLOCKED" });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.destroy).toHaveBeenCalled();
  });
  it("caps chunked response bytes and cancels the body", async () => {
    const cancel = vi.fn();
    mocks.fetch.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(3));
            c.enqueue(new Uint8Array(3));
          },
          cancel,
        }),
      ),
    );
    await expect(
      createUserAIFetch("https://example.com", { maxResponseBytes: 5 })(
        "https://example.com",
      ),
    ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
    expect(cancel).toHaveBeenCalled();
    expect(mocks.destroy).toHaveBeenCalled();
  });
  it("keeps total deadline through a stalled response body", async () => {
    mocks.fetch.mockResolvedValue(new Response(new ReadableStream()));
    await expect(
      createUserAIFetch("https://example.com", { timeoutMs: 15 })(
        "https://example.com",
      ),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(mocks.destroy).toHaveBeenCalled();
  });
  it("bounds stalled DNS", async () => {
    mocks.lookup.mockReturnValue(new Promise(() => undefined));
    await expect(
      createUserAIFetch("https://example.com", { timeoutMs: 15 })(
        "https://example.com",
      ),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });
  it("honors caller cancellation during body consumption without leaking its reason", async () => {
    const controller = new AbortController();
    mocks.fetch.mockResolvedValue(new Response(new ReadableStream()));
    const promise = createUserAIFetch("https://example.com")(
      "https://example.com",
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(new Error("Authorization SECRET")), 5);
    await expect(promise).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
      message: "AI connection failed.",
    });
  });
  it("sanitizes lower-level failures", async () => {
    mocks.fetch.mockRejectedValue(
      new Error("Authorization SECRET https://private"),
    );
    const error = await createUserAIFetch("https://example.com")(
      "https://example.com",
    ).catch((error: unknown) => error);
    expect(error).toMatchObject({
      code: "CONNECTION_FAILED",
      message: "AI connection failed.",
    });
    expect(error).not.toHaveProperty("cause");
  });
  it.each(["%2f..%2foutside", "%5c..%5coutside", "%252f..%252foutside"])(
    "rejects encoded path escapes %s",
    async (path) => {
      await expect(
        createUserAIFetch("https://example.com/api")(
          `https://example.com/api/${path}`,
        ),
      ).rejects.toMatchObject({ code: "INVALID_URL" });
      expect(mocks.lookup).not.toHaveBeenCalled();
    },
  );
  it("rejects Host overrides", async () => {
    await expect(
      createUserAIFetch("https://example.com")("https://example.com", {
        headers: { Host: "internal" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_URL" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it.each([
    "https://example.com:8443",
    "http://example.com",
    "https://example.com.evil",
    "https://example.com/path",
  ])("does not allow private access for %s", async (origin) => {
    mocks.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(
      createUserAIFetch("https://example.com", {
        allowedPrivateOrigins: [origin],
      })("https://example.com"),
    ).rejects.toMatchObject({ code: "ADDRESS_BLOCKED" });
  });
  it("honors an already aborted Request without DNS", async () => {
    const controller = new AbortController();
    controller.abort("SECRET");
    await expect(
      createUserAIFetch("https://example.com")(
        new Request("https://example.com", { signal: controller.signal }),
      ),
    ).rejects.toMatchObject({ code: "CONNECTION_FAILED" });
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
  it("caps declared response size before reading", async () => {
    mocks.fetch.mockResolvedValue(
      new Response("x", { headers: { "content-length": "100" } }),
    );
    await expect(
      createUserAIFetch("https://example.com", { maxResponseBytes: 10 })(
        "https://example.com",
      ),
    ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });
  it("times out stalled headers and destroys the dispatcher", async () => {
    mocks.fetch.mockReturnValue(new Promise(() => undefined));
    await expect(
      createUserAIFetch("https://example.com", { timeoutMs: 15 })(
        "https://example.com",
      ),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(mocks.destroy).toHaveBeenCalled();
  });
  it("preserves Request method, auth and body while using its own dispatcher", async () => {
    const request = new Request("https://example.com/api?q=1", {
      method: "POST",
      headers: { authorization: "Bearer SECRET" },
      body: "{}",
    });
    await createUserAIFetch("https://example.com")(request);
    expect(mocks.fetch.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: expect.arrayContaining([["authorization", "Bearer SECRET"]]),
    });
  });
  it("blocks Azure platform metadata even when allowlisted", async () => {
    mocks.lookup.mockResolvedValue([{ address: "168.63.129.16", family: 4 }]);
    await expect(
      createUserAIFetch("https://example.com", {
        allowedPrivateOrigins: ["https://example.com"],
      })("https://example.com"),
    ).rejects.toMatchObject({ code: "ADDRESS_BLOCKED" });
  });
  it("rejects even empty URL userinfo", () => {
    expect(() => normalizeUserAIBaseUrl("https://@example.com")).toThrow(
      UserAINetworkError,
    );
  });
  it("sanitizes body stream failures and releases resources", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(c) {
            c.error(new Error("SECRET"));
          },
        }),
      ),
    );
    await expect(
      createUserAIFetch("https://example.com")("https://example.com"),
    ).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
      message: "AI connection failed.",
    });
    expect(mocks.destroy).toHaveBeenCalled();
  });
  it("accepts public IPv6 and mapped public IPv4", async () => {
    for (const address of ["2606:4700:4700::1111", "::ffff:93.184.216.34"]) {
      mocks.lookup.mockResolvedValue([{ address, family: 6 }]);
      mocks.fetch.mockResolvedValue(new Response("ok"));
      expect(
        await (
          await createUserAIFetch("https://example.com")("https://example.com")
        ).text(),
      ).toBe("ok");
    }
  });
  it("rejects invalid resource bounds", () => {
    for (const value of [0, -1, NaN, Infinity, 0.5]) {
      expect(() =>
        createUserAIFetch("https://example.com", { timeoutMs: value }),
      ).toThrow(UserAINetworkError);
      expect(() =>
        createUserAIFetch("https://example.com", { maxResponseBytes: value }),
      ).toThrow(UserAINetworkError);
    }
  });
});
