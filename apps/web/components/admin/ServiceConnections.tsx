"use client";

import { AdminCard } from "@/components/admin/AdminCard";
import { useTranslation } from "@/lib/i18n/client";
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "@karakeep/shared-react/trpc";
import type { ZResolverHealth } from "@karakeep/shared/types/resolverHealth";

function ConnectionStatus({
  label,
  configured,
  connected,
  pluginName,
  error,
  notChecked = false,
  statusLabel,
  checkedAt,
  latencyMs,
}: {
  label: string;
  configured: boolean;
  connected: boolean;
  pluginName?: string;
  error?: string;
  notChecked?: boolean;
  statusLabel?: string;
  checkedAt?: Date;
  latencyMs?: number | null;
}) {
  const { t } = useTranslation();

  let statusText = t("admin.service_connections.status.not_configured");
  let badgeColor =
    "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
  let iconColor = "text-gray-400";
  let borderColor = "border-gray-200 dark:border-gray-700";

  if (configured) {
    if (connected) {
      statusText = t("admin.service_connections.status.connected");
      badgeColor =
        "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400";
      iconColor = "text-green-500";
      borderColor = "border-green-200 dark:border-green-800";
    } else {
      statusText = t("admin.service_connections.status.disconnected");
      badgeColor =
        "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400";
      iconColor = "text-red-500";
      borderColor = "border-red-200 dark:border-red-800";
    }
  }

  if (notChecked) {
    statusText = t("admin.service_connections.status.not_checked");
    badgeColor =
      "bg-yellow-50 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300";
    iconColor = "text-yellow-500";
    borderColor = "border-yellow-200 dark:border-yellow-800";
  }

  return (
    <div
      className={`rounded-lg border ${borderColor} bg-background p-5 shadow-sm transition-all`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0 break-words">
          <div className="text-base font-semibold">{label}</div>
          {pluginName && (
            <div className="mt-1 text-xs text-muted-foreground">
              {pluginName}
            </div>
          )}
        </div>
        <div
          className={`flex h-2 w-2 shrink-0 items-center justify-center rounded-full ${iconColor}`}
        >
          <div
            className={`h-2 w-2 rounded-full ${connected && configured ? "animate-pulse" : ""} bg-current`}
          ></div>
        </div>
      </div>
      <div className="mb-2">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeColor}`}
        >
          {statusLabel ?? statusText}
        </span>
      </div>
      {error && (
        <div
          className={`mt-3 rounded-md p-2 ${notChecked ? "bg-yellow-50 dark:bg-yellow-900/10" : "bg-red-50 dark:bg-red-900/10"}`}
        >
          <p
            className={`break-words text-xs ${notChecked ? "text-yellow-800 dark:text-yellow-300" : "text-red-600 dark:text-red-400"}`}
            title={error}
          >
            {error}
          </p>
        </div>
      )}
      {checkedAt && (
        <div className="mt-3 space-y-1 break-words text-xs text-muted-foreground">
          {latencyMs != null && (
            <div>
              {t("admin.service_connections.latency", { ms: latencyMs })}
            </div>
          )}
          <div>
            {t("admin.service_connections.last_checked", {
              time: checkedAt.toLocaleTimeString(),
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectionsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading connections"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="rounded-lg border border-gray-200 bg-background p-5 shadow-sm dark:border-gray-700"
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="h-5 w-28 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
            <div className="h-2 w-2 animate-pulse rounded-full bg-gray-300 dark:bg-gray-600"></div>
          </div>
          <div className="mb-2">
            <div className="h-5 w-20 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700"></div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ResolverConnections() {
  const api = useTRPC();
  const { t } = useTranslation();
  const { data, isError } = useQuery(
    api.admin.checkResolverConnections.queryOptions(undefined, {
      refetchInterval: 10000,
    }),
  );
  return (
    <section
      className="mt-6 border-t pt-5"
      aria-labelledby="resolver-connections-title"
    >
      <h3 id="resolver-connections-title" className="text-base font-medium">
        {t("admin.service_connections.resolver_title")}
      </h3>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">
        {t("admin.service_connections.resolver_health_notice")}
      </p>
      {isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("admin.service_connections.query_failed")}
        </p>
      ) : !data ? (
        <ConnectionsSkeleton count={5} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {data.map((health: ZResolverHealth) => (
            <ConnectionStatus
              key={health.id}
              label={t(`admin.service_connections.resolvers.${health.id}`)}
              configured={health.status !== "not_configured"}
              connected={health.status === "connected"}
              notChecked={health.status === "not_checked"}
              statusLabel={
                health.status === "error"
                  ? t("admin.service_connections.status.check_failed")
                  : undefined
              }
              error={
                health.errorCode
                  ? t(`admin.service_connections.errors.${health.errorCode}`, {
                      status: health.httpStatus,
                    })
                  : undefined
              }
              checkedAt={health.checkedAt}
              latencyMs={health.latencyMs}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function ServiceConnections() {
  const api = useTRPC();
  const { t } = useTranslation();
  const { data: connections } = useQuery(
    api.admin.checkConnections.queryOptions(undefined, {
      refetchInterval: 10000,
    }),
  );

  return (
    <AdminCard>
      <div className="mb-2 text-xl font-medium">
        {t("admin.service_connections.title")}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        {t("admin.service_connections.description")}
      </p>
      {!connections ? (
        <ConnectionsSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <ConnectionStatus
            label={t("admin.service_connections.search_engine")}
            configured={connections.searchEngine.configured}
            connected={connections.searchEngine.connected}
            pluginName={connections.searchEngine.pluginName}
            error={connections.searchEngine.error}
          />
          <ConnectionStatus
            label={t("admin.service_connections.browser")}
            configured={connections.browser.configured}
            connected={connections.browser.connected}
            pluginName={connections.browser.pluginName}
            error={connections.browser.error}
          />
          <ConnectionStatus
            label={t("admin.service_connections.queue_system")}
            configured={connections.queue.configured}
            connected={connections.queue.connected}
            pluginName={connections.queue.pluginName}
            error={connections.queue.error}
          />
          <ConnectionStatus
            label={t("admin.service_connections.vector_store")}
            configured={connections.vectorStore.configured}
            connected={connections.vectorStore.connected}
            pluginName={connections.vectorStore.pluginName}
            error={connections.vectorStore.error}
          />
        </div>
      )}
      <ResolverConnections />
    </AdminCard>
  );
}
