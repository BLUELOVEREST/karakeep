"use client";

import { useState } from "react";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FullPageSpinner } from "@/components/ui/full-page-spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { useTRPC } from "@karakeep/shared-react/trpc";
import type {
  ResolverId,
  ResolverRuntimeSetting,
  ResolverSecretKey,
} from "@karakeep/shared/types/resolverSettings";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Save, Trash2 } from "lucide-react";

import { SettingsPage, SettingsSection } from "./SettingsPage";

interface ResolverField {
  title: string;
  description: string;
  resolverId: ResolverId;
  secretKey: ResolverSecretKey;
  placeholder: string;
  status: ResolverRuntimeSetting;
}

function formatDate(date: Date | null) {
  if (!date) {
    return "Never";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function sourceLabel(source: "runtime" | "environment" | "unset") {
  if (source === "runtime") {
    return "Managed in UI";
  }
  if (source === "environment") {
    return "From environment";
  }
  return "Unset";
}

export function getSecretPlaceholder(configured: boolean, placeholder: string) {
  if (configured) {
    return "Configured: ********. Paste a new value to replace it.";
  }
  return placeholder;
}

function ResolverSecretCard({ field }: { field: ResolverField }) {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");

  const invalidate = () =>
    queryClient.invalidateQueries(api.resolverSettings.status.pathFilter());

  const update = useMutation(
    api.resolverSettings.update.mutationOptions({
      onSuccess: () => {
        setValue("");
        invalidate();
        toast({ description: `${field.title} saved.` });
      },
      onError: (error) => {
        toast({
          description: error.message,
          variant: "destructive",
        });
      },
    }),
  );

  const clear = useMutation(
    api.resolverSettings.clear.mutationOptions({
      onSuccess: () => {
        invalidate();
        toast({ description: `${field.title} cleared.` });
      },
      onError: (error) => {
        toast({
          description: error.message,
          variant: "destructive",
        });
      },
    }),
  );

  return (
    <SettingsSection
      title={field.title}
      description={field.description}
      action={
        <Badge variant={field.status.configured ? "default" : "secondary"}>
          {field.status.configured ? "Configured" : "Not configured"}
        </Badge>
      }
    >
      <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
        <div>Source: {sourceLabel(field.status.source)}</div>
        <div>Updated: {formatDate(field.status.modifiedAt)}</div>
      </div>

      <Textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={getSecretPlaceholder(
          field.status.configured,
          field.placeholder,
        )}
        className="min-h-24 font-mono text-sm"
      />

      <div className="flex flex-wrap gap-2">
        <ActionButton
          loading={update.isPending}
          disabled={!value.trim()}
          onClick={() =>
            update.mutate({
              resolverId: field.resolverId,
              key: field.secretKey,
              value,
            })
          }
        >
          <Save className="mr-2 size-4" />
          Save
        </ActionButton>
        <Button
          variant="outline"
          disabled={!field.status.configured || clear.isPending}
          onClick={() =>
            clear.mutate({
              resolverId: field.resolverId,
              key: field.secretKey,
            })
          }
        >
          <Trash2 className="mr-2 size-4" />
          Clear runtime value
        </Button>
      </div>
    </SettingsSection>
  );
}

export default function ResolverSettings() {
  const api = useTRPC();
  const { data, isLoading } = useQuery(
    api.resolverSettings.status.queryOptions(),
  );

  if (isLoading || !data) {
    return <FullPageSpinner />;
  }

  const fields: ResolverField[] = [
    {
      title: "Xiaohongshu Cookie",
      description:
        "Used by the Spider_XHS resolver for note parsing and media downloads.",
      resolverId: "xiaohongshu",
      secretKey: "xhsCookie",
      placeholder: "Paste XHS_COOKIE here. Existing values are never shown.",
      status: data.xiaohongshu.xhsCookie,
    },
    {
      title: "Douyin Cookie",
      description:
        "Used by the Douyin resolver for video metadata and downloads.",
      resolverId: "douyin",
      secretKey: "douyinCookie",
      placeholder: "Paste DOUYIN_COOKIE here. Existing values are never shown.",
      status: data.douyin.douyinCookie,
    },
    {
      title: "WeChat Article Auth Key",
      description: "Sent by Karakeep when calling the WeChat article resolver.",
      resolverId: "wechat",
      secretKey: "wechatArticleAuthKey",
      placeholder:
        "Paste WECHAT_ARTICLE_AUTH_KEY here. Existing values are never shown.",
      status: data.wechat.wechatArticleAuthKey,
    },
  ];

  return (
    <SettingsPage
      title="Resolver Settings"
      description="Manage runtime secrets for third-party platform resolvers."
    >
      <div className="flex items-start gap-3 rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
        <KeyRound className="mt-0.5 size-4 shrink-0" />
        <p>
          Secret values are stored for server-side use and are not rendered back
          to the browser. New crawl and refresh jobs use the latest saved value.
          Xiaohongshu and Douyin cookies are pushed to their resolver services
          when saved and before matching crawl jobs run.
        </p>
      </div>
      {fields.map((field) => (
        <ResolverSecretCard key={field.secretKey} field={field} />
      ))}
    </SettingsPage>
  );
}
