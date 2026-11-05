// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ServiceConnections from "./ServiceConnections";

const state = vi.hoisted(() => ({
  resolverData: undefined as unknown,
  resolverError: false,
  coreLoading: false,
}));
vi.mock("@/lib/i18n/client", () => ({
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));
vi.mock("@karakeep/shared-react/trpc", () => ({
  useTRPC: () => ({
    admin: {
      checkConnections: { queryOptions: () => ({ kind: "core" }) },
      checkResolverConnections: { queryOptions: () => ({ kind: "resolvers" }) },
    },
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { kind: string }) =>
    options.kind === "core"
      ? {
          data: state.coreLoading
            ? undefined
            : Object.fromEntries(
                ["browser", "queue", "searchEngine", "vectorStore"].map(
                  (id) => [id, { configured: true, connected: true }],
                ),
              ),
        }
      : { data: state.resolverData, isError: state.resolverError },
}));

afterEach(cleanup);
beforeEach(() => {
  state.resolverData = undefined;
  state.resolverError = false;
  state.coreLoading = false;
});

describe("administrator resolver connection panel", () => {
  it("shows all five resolvers and timing without hiding core service connections", () => {
    state.resolverData = [
      "xiaohongshu",
      "douyin",
      "wechat",
      "coolapk",
      "smzdm",
    ].map((id) => ({
      id,
      status: "connected",
      checkedAt: new Date("2026-11-05T08:00:00Z"),
      latencyMs: 12,
      errorCode: null,
      httpStatus: 200,
    }));
    render(<ServiceConnections />);
    for (const id of ["xiaohongshu", "douyin", "wechat", "coolapk", "smzdm"])
      expect(
        screen.getByText(`admin.service_connections.resolvers.${id}`),
      ).toBeTruthy();
    expect(
      screen.getByText("admin.service_connections.search_engine"),
    ).toBeTruthy();
    expect(
      screen.getAllByText(/admin.service_connections.latency/),
    ).toHaveLength(5);
    expect(
      screen.getAllByText(/admin.service_connections.last_checked/),
    ).toHaveLength(5);
    expect(
      screen.getByText("admin.service_connections.resolver_health_notice"),
    ).toBeTruthy();
  });

  it("distinguishes unsupported health endpoints from unhealthy services", () => {
    state.resolverData = [
      {
        id: "wechat",
        status: "not_checked",
        checkedAt: new Date(),
        latencyMs: 20,
        errorCode: "HEALTH_CHECK_UNSUPPORTED",
        httpStatus: 404,
      },
      {
        id: "douyin",
        status: "error",
        checkedAt: new Date(),
        latencyMs: 30,
        errorCode: "HTTP_ERROR",
        httpStatus: 503,
      },
    ];
    render(<ServiceConnections />);
    expect(
      screen.getByText("admin.service_connections.status.not_checked"),
    ).toBeTruthy();
    expect(
      screen.getByText("admin.service_connections.status.check_failed"),
    ).toBeTruthy();
    expect(screen.getByText(/errors.HEALTH_CHECK_UNSUPPORTED/)).toBeTruthy();
    expect(screen.getByText(/errors.HTTP_ERROR/)).toBeTruthy();
  });

  it("shows a resolver query error instead of an endless loading state", () => {
    state.resolverError = true;
    render(<ServiceConnections />);
    expect(screen.getByRole("alert").textContent).toContain(
      "admin.service_connections.query_failed",
    );
    expect(
      screen.getByText("admin.service_connections.search_engine"),
    ).toBeTruthy();
  });

  it("can show resolver health while core service checks are still loading", () => {
    state.coreLoading = true;
    state.resolverData = [
      {
        id: "coolapk",
        status: "not_configured",
        checkedAt: new Date(),
        latencyMs: null,
        errorCode: null,
        httpStatus: null,
      },
    ];
    render(<ServiceConnections />);
    expect(
      screen.getByText("admin.service_connections.resolvers.coolapk"),
    ).toBeTruthy();
  });
});
