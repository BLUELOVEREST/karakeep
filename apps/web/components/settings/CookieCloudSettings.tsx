"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Save } from "lucide-react";

import { ActionButton } from "@/components/ui/action-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { COOKIECLOUD_SCHEDULES } from "@karakeep/shared/types/cookiecloud";
import type { CookieCloudSettings as Settings } from "@karakeep/shared/types/cookiecloud";

import { SettingsSection } from "./SettingsPage";

const schedules = [
  ["hourly", "Every hour"],
  ["sixHours", "Every 6 hours"],
  ["twelveHours", "Every 12 hours"],
  ["daily", "Every day"],
  ["custom", "Custom cron"],
] as const;

const outcomes = {
  updated: "Updated",
  missing: "No applicable cookies",
  failed: "Failed",
  unavailable: "Resolver not configured",
};

export default function CookieCloudSettings() {
  const api = useTRPC();
  const client = useQueryClient();
  const query = useQuery({
    ...api.resolverSettings.cookieCloudStatus.queryOptions(),
    refetchInterval: 15000,
  });
  const [draft, setDraft] = useState<Settings | null>(null);
  const [custom, setCustom] = useState(false);
  const [password, setPassword] = useState("");
  const refresh = () => {
    void client.invalidateQueries(
      api.resolverSettings.cookieCloudStatus.pathFilter(),
    );
    void client.invalidateQueries(api.resolverSettings.status.pathFilter());
  };
  const error = (error: { message: string }) =>
    toast({ description: error.message, variant: "destructive" });
  const save = useMutation(
    api.resolverSettings.saveCookieCloud.mutationOptions({
      onSuccess: () => {
        setDraft(null);
        setPassword("");
        refresh();
        toast({ description: "CookieCloud settings saved." });
      },
      onError: error,
    }),
  );
  const sync = useMutation(
    api.resolverSettings.syncCookieCloud.mutationOptions({
      onSuccess: () => {
        refresh();
      },
      onError: error,
    }),
  );
  if (query.isError)
    return (
      <SettingsSection title="CookieCloud">
        <div role="alert" className="text-sm text-destructive">
          {query.error.message}
        </div>
        <ActionButton
          variant="outline"
          loading={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw className="mr-2 size-4" />
          Retry
        </ActionButton>
      </SettingsSection>
    );
  if (!query.data) return null;
  const data = query.data;
  const values = draft ?? data;
  const update = (patch: Partial<Settings>) =>
    setDraft({ ...values, ...patch });
  const preset = custom
    ? "custom"
    : (Object.entries(COOKIECLOUD_SCHEDULES).find(
        ([, expression]) => expression === values.cron,
      )?.[0] ?? "custom");
  const result = data.lastResult;
  const syncing = sync.isPending || save.isPending;

  return (
    <SettingsSection title="CookieCloud">
      <div className="flex items-center gap-3">
        <Switch
          id="cookiecloud-enabled"
          checked={values.enabled}
          onCheckedChange={(enabled) => update({ enabled })}
        />
        <Label htmlFor="cookiecloud-enabled">Automatic synchronization</Label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="cookiecloud-url">Server URL</Label>
          <Input
            id="cookiecloud-url"
            value={values.url}
            placeholder="https://cookiecloud.example.com"
            onChange={(e) => update({ url: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cookiecloud-uuid">UUID</Label>
          <Input
            id="cookiecloud-uuid"
            autoComplete="off"
            value={values.uuid}
            onChange={(e) => update({ uuid: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cookiecloud-password">Decryption password</Label>
          <Input
            id="cookiecloud-password"
            type="password"
            autoComplete="new-password"
            value={password}
            placeholder={
              data.passwordConfigured ? "Configured: ********" : "Password"
            }
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cookiecloud-schedule">Schedule</Label>
          <Select
            value={preset}
            onValueChange={(value) => {
              setCustom(value === "custom");
              if (value !== "custom")
                update({
                  cron: COOKIECLOUD_SCHEDULES[
                    value as keyof typeof COOKIECLOUD_SCHEDULES
                  ],
                });
            }}
          >
            <SelectTrigger id="cookiecloud-schedule">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {schedules.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {preset === "custom" && (
          <div className="space-y-2">
            <Label htmlFor="cookiecloud-cron">Cron expression (5 fields)</Label>
            <Input
              id="cookiecloud-cron"
              className="font-mono"
              value={values.cron}
              placeholder="0 */6 * * *"
              onChange={(e) => update({ cron: e.target.value })}
            />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="cookiecloud-timezone">Timezone</Label>
          <Input
            id="cookiecloud-timezone"
            value={values.timezone}
            placeholder="Asia/Shanghai"
            onChange={(e) => update({ timezone: e.target.value })}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <ActionButton
          loading={save.isPending}
          disabled={syncing || (!draft && !password)}
          onClick={() =>
            save.mutate({ ...values, password: password || undefined })
          }
        >
          <Save className="mr-2 size-4" />
          Save
        </ActionButton>
        <ActionButton
          variant="outline"
          loading={sync.isPending}
          disabled={
            syncing ||
            !!draft ||
            !!password ||
            !data.url ||
            !data.uuid ||
            !data.passwordConfigured
          }
          onClick={() => sync.mutate()}
        >
          <RefreshCw className="mr-2 size-4" />
          Sync now
        </ActionButton>
      </div>
      <div
        className="space-y-1 text-sm text-muted-foreground"
        aria-live="polite"
      >
        <div>
          Last attempt:{" "}
          {result ? new Date(result.attemptedAt).toLocaleString() : "Never"}
        </div>
        {result && (
          <>
            <div>
              Xiaohongshu: {outcomes[result.platforms.xiaohongshu]} · Douyin:{" "}
              {outcomes[result.platforms.douyin]}
            </div>
            {result.error && (
              <div role="alert" className="text-destructive">
                {result.error}
              </div>
            )}
          </>
        )}
      </div>
    </SettingsSection>
  );
}
