import { useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { Service } from "@shared/schema";
import type { TelegramChannelOption, TelegramImportStatus, TelegramServiceDraft } from "@shared/telegram-import";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { AlertEditorActions, AlertEditorDialogContent, AlertEditorScrollArea } from "@/components/alert-editor-dialog";
import { RichTextEditor, stripHtml } from "@/components/rich-text-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { AlertTriangle, Check, Clock3, ExternalLink, RefreshCw, Send, Settings2, ShieldCheck, Trash2 } from "lucide-react";

const ROOT = "/api/admin/telegram-import";
const PENDING_KEY = [ROOT, "drafts"];
const STATUS_KEY = [ROOT, "status"];
type DraftFields = { title: string; description: string; serviceId: string; matureContent: boolean };

async function readJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

export function TelegramImportPanel({ canManage }: { canManage: boolean }) {
  const { isMasterAdmin } = useAuth();
  const { toast } = useToast();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const deepDraftId = params.get("telegramDraft");
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fields, setFields] = useState<DraftFields>({ title: "", description: "", serviceId: "", matureContent: false });
  const savedFields = useRef<DraftFields | null>(null);
  const [discardEditsOpen, setDiscardEditsOpen] = useState(false);
  const initializedId = useRef<string | null>(null);
  const openedDeepLink = useRef<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [loginCode, setLoginCode] = useState("");
  const [password, setPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [showRestartLogin, setShowRestartLogin] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [draftUnavailable, setDraftUnavailable] = useState(false);
  const selectedWasPending = useRef(false);
  const pendingListVersionAtOpen = useRef(0);

  const statusQuery = useQuery<TelegramImportStatus>({
    queryKey: STATUS_KEY,
    queryFn: async () => readJson(await apiRequest("GET", `${ROOT}/status`)),
    enabled: isMasterAdmin,
    refetchInterval: 30_000,
  });
  const status = statusQuery.data;
  const channelsQuery = useQuery<TelegramChannelOption[]>({
    queryKey: [ROOT, "channels"],
    queryFn: async () => readJson(await apiRequest("GET", `${ROOT}/channels`)),
    enabled: isMasterAdmin && !!status?.configured && !!status?.connected,
    refetchInterval: 30_000,
  });
  const draftsQuery = useQuery<TelegramServiceDraft[]>({
    queryKey: PENDING_KEY,
    queryFn: async () => readJson(await apiRequest("GET", `${ROOT}/drafts`)),
    refetchInterval: 30_000,
  });
  const linkedDraftQuery = useQuery<TelegramServiceDraft>({
    queryKey: [ROOT, "draft", deepDraftId],
    queryFn: async () => readJson(await apiRequest("GET", `${ROOT}/drafts/${encodeURIComponent(deepDraftId!)}`)),
    enabled: !!deepDraftId,
    retry: false,
  });
  const servicesQuery = useQuery<Service[]>({ queryKey: ["/api/services"] });

  const updateStatus = (statusData: TelegramImportStatus) => {
    queryClient.setQueryData(STATUS_KEY, statusData);
    setErrorMessage("");
  };
  const statusMutation = useMutation({
    mutationFn: async ({ path, method, data }: { path: string; method: string; data?: unknown }) =>
      readJson<TelegramImportStatus>(await apiRequest(method, `${ROOT}${path}`, data)),
    onSuccess: updateStatus,
    onError: (error) => setErrorMessage(messageFrom(error)),
  });
  const saveDraft = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: DraftFields }) =>
      readJson<TelegramServiceDraft>(await apiRequest("PATCH", `${ROOT}/drafts/${encodeURIComponent(id)}`, values)),
    onSuccess: (draft, variables) => {
      savedFields.current = { ...variables.values };
      queryClient.setQueryData([ROOT, "draft", draft.id], draft);
      queryClient.invalidateQueries({ queryKey: PENDING_KEY });
      toast({ title: "Draft saved", description: "It remains private until you publish it." });
    },
    onError: (error) => toast({ title: "Could not save draft", description: messageFrom(error), variant: "destructive" }),
  });
  const publishDraft = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: DraftFields }) =>
      readJson<{ id: string; notificationWarning?: string }>(await apiRequest("POST", `${ROOT}/drafts/${encodeURIComponent(id)}/publish`, values)),
    onSuccess: async (result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/service-updates"] }),
        queryClient.invalidateQueries({ queryKey: PENDING_KEY }),
        queryClient.invalidateQueries({ queryKey: [ROOT, "draft", variables.id] }),
      ]);
      toast({
        title: result.notificationWarning ? "Published — notification issue" : "Update published",
        description: result.notificationWarning || "Subscriber notifications have been requested.",
        ...(result.notificationWarning ? { variant: "destructive" as const } : {}),
      });
      closeEditor(true);
    },
    onError: (error) => toast({ title: "Could not publish update", description: messageFrom(error), variant: "destructive" }),
  });
  const deleteDraft = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `${ROOT}/drafts/${encodeURIComponent(id)}`),
    onSuccess: async (_result, id) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: PENDING_KEY }),
        queryClient.invalidateQueries({ queryKey: [ROOT, "draft", id] }),
      ]);
      toast({ title: "Draft deleted" });
      closeEditor(true);
    },
    onError: (error) => toast({ title: "Could not delete draft", description: messageFrom(error), variant: "destructive" }),
  });
  const draftMutationPending = saveDraft.isPending || publishDraft.isPending || deleteDraft.isPending;

  function closeEditor(force = false) {
    if (!force && !draftUnavailable && savedFields.current &&
        JSON.stringify(savedFields.current) !== JSON.stringify(fields)) {
      setDiscardEditsOpen(true);
      return;
    }
    setDiscardEditsOpen(false);
    setEditorOpen(false);
    setSelectedId(null);
    initializedId.current = null;
    selectedWasPending.current = false;
    setDraftUnavailable(false);
    savedFields.current = null;
    if (deepDraftId) {
      const next = new URLSearchParams(search);
      next.delete("telegramDraft");
      setLocation(`/admin${next.size ? `?${next.toString()}` : ""}`);
    }
  }

  function openDraft(draft: TelegramServiceDraft) {
    setSelectedId(draft.id);
    initializedId.current = draft.id;
    selectedWasPending.current = !!draftsQuery.data?.some((item) => item.id === draft.id);
    pendingListVersionAtOpen.current = draftsQuery.dataUpdatedAt;
    setDraftUnavailable(!!draft.publishedUpdateId || draft.status !== "pending");
    setFields({ title: draft.title, description: draft.description, serviceId: draft.serviceId, matureContent: draft.matureContent });
    savedFields.current = { title: draft.title, description: draft.description, serviceId: draft.serviceId, matureContent: draft.matureContent };
    setEditorOpen(true);
  }
  const openDraftRef = useRef(openDraft);
  openDraftRef.current = openDraft;

  useEffect(() => {
    if (!deepDraftId) {
      openedDeepLink.current = null;
      return;
    }
    if (openedDeepLink.current === deepDraftId) return;
    if (linkedDraftQuery.data?.id === deepDraftId) {
      openedDeepLink.current = deepDraftId;
      openDraftRef.current(linkedDraftQuery.data);
      return;
    }
    if (linkedDraftQuery.isError) {
      openedDeepLink.current = deepDraftId;
      setSelectedId(deepDraftId);
      selectedWasPending.current = false;
      setEditorOpen(true);
      setDraftUnavailable(/^404:/.test(messageFrom(linkedDraftQuery.error)));
    }
  }, [deepDraftId, linkedDraftQuery.data, linkedDraftQuery.isError, linkedDraftQuery.error]);

  const selectedDraft = selectedId
    ? linkedDraftQuery.data?.id === selectedId
      ? linkedDraftQuery.data
      : draftsQuery.data?.find((draft) => draft.id === selectedId)
    : null;
  const linkedDraftFetchFailed = !!deepDraftId && selectedId === deepDraftId && linkedDraftQuery.isError &&
    !/^404:/.test(messageFrom(linkedDraftQuery.error));

  useEffect(() => {
    const draft = linkedDraftQuery.data;
    if (!selectedId || draft?.id !== selectedId || initializedId.current === selectedId) return;
    initializedId.current = selectedId;
    setFields({ title: draft.title, description: draft.description, serviceId: draft.serviceId, matureContent: draft.matureContent });
    savedFields.current = { title: draft.title, description: draft.description, serviceId: draft.serviceId, matureContent: draft.matureContent };
    setDraftUnavailable(!!draft.publishedUpdateId || draft.status !== "pending");
  }, [selectedId, linkedDraftQuery.data]);

  useEffect(() => {
    if (!selectedId || !draftsQuery.isSuccess) return;
    const listed = draftsQuery.data?.some((draft) => draft.id === selectedId) ?? false;
    if (listed) {
      selectedWasPending.current = true;
      return;
    }
    if (selectedWasPending.current && draftsQuery.dataUpdatedAt > pendingListVersionAtOpen.current) {
      setDraftUnavailable(true);
    }
  }, [selectedId, draftsQuery.data, draftsQuery.dataUpdatedAt, draftsQuery.isSuccess]);

  async function submitLogin(path: "/login/start" | "/login/code" | "/login/password", data: { phoneNumber?: string; code?: string; password?: string }) {
    if (loginBusy) return;
    if (path === "/login/start") setPhoneNumber("");
    if (path === "/login/code") setLoginCode("");
    if (path === "/login/password") setPassword("");
    setErrorMessage("");
    setLoginBusy(true);
    try {
      const result = await readJson<TelegramImportStatus>(await apiRequest("POST", `${ROOT}${path}`, data));
      updateStatus(result);
      setShowRestartLogin(false);
    } catch (error) {
      setErrorMessage(messageFrom(error));
    } finally {
      setLoginBusy(false);
    }
  }

  const validPublish = fields.title.trim().length > 0 && stripHtml(fields.description).trim().length > 0 && !!fields.serviceId;

  return (
    <section className="overflow-hidden rounded-xl border border-card-border bg-card" data-testid="panel-telegram-import">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-sky-500/10 text-sky-700 dark:text-sky-300">
            <Send className="h-[18px] w-[18px]" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Telegram imports</h2>
            <p className="text-xs text-muted-foreground">Review private drafts before subscribers see anything.</p>
          </div>
        </div>
        {isMasterAdmin && status && (
          <Badge variant={status.connected ? "default" : "outline"} data-testid="badge-telegram-connection">
            {status.connected ? "Connected" : "Not connected"}
          </Badge>
        )}
      </div>

      {isMasterAdmin && (
        <div className="border-b border-border bg-muted/20 px-5 py-4">
          {statusQuery.isLoading ? <div className="h-20 animate-pulse rounded-md bg-muted" data-testid="skeleton-telegram-status" /> :
            statusQuery.isError ? (
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm" data-testid="text-telegram-status-error">
                <span className="text-destructive">Connection settings could not be loaded.</span>
                <Button size="sm" variant="outline" onClick={() => statusQuery.refetch()} data-testid="button-retry-telegram-status">Retry</Button>
              </div>
            ) : status?.configured ? (
              <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
                <div className="space-y-3">
                  {status.error && <p className="flex items-start gap-2 text-xs text-destructive" data-testid="text-telegram-connection-error"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{status.error}</p>}
                  {!status.connected ? (
                    <div className="space-y-3">
                      {(status.loginStep === "idle" || showRestartLogin) && (
                        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); if (phoneNumber.trim()) void submitLogin("/login/start", { phoneNumber: phoneNumber.trim() }); }}>
                          <Input value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} type="tel" autoComplete="tel" placeholder="Telegram phone number" aria-label="Telegram phone number" data-testid="input-telegram-phone" />
                          <Button type="submit" disabled={loginBusy || !phoneNumber.trim()} data-testid="button-telegram-start-login">Send sign-in code</Button>
                          {showRestartLogin && <Button type="button" variant="outline" onClick={() => setShowRestartLogin(false)} data-testid="button-cancel-telegram-restart">Cancel</Button>}
                        </form>
                      )}
                      {!showRestartLogin && status.loginStep === "code" && (
                        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); if (loginCode.trim()) void submitLogin("/login/code", { code: loginCode.trim() }); }}>
                          <Input value={loginCode} onChange={(event) => setLoginCode(event.target.value)} type="password" inputMode="numeric" autoComplete="one-time-code" placeholder="Telegram sign-in code" aria-label="Telegram sign-in code" data-testid="input-telegram-code" />
                          <Button type="submit" disabled={loginBusy || !loginCode.trim()} data-testid="button-telegram-submit-code">Verify code</Button>
                        </form>
                      )}
                      {!showRestartLogin && status.loginStep === "password" && (
                        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); if (password) void submitLogin("/login/password", { password }); }}>
                          <Input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" placeholder="Two-step verification password" aria-label="Telegram two-step verification password" data-testid="input-telegram-password" />
                          <Button type="submit" disabled={loginBusy || !password} data-testid="button-telegram-submit-password">Verify password</Button>
                        </form>
                      )}
                      {!showRestartLogin && status.loginStep !== "idle" && (
                        <Button type="button" size="sm" variant="ghost" className="px-0 text-xs" disabled={loginBusy} onClick={() => { setPhoneNumber(""); setLoginCode(""); setPassword(""); setShowRestartLogin(true); }} data-testid="button-telegram-restart-login">Code expired? Start sign-in again</Button>
                      )}
                      <p className="text-xs text-muted-foreground">Use a dedicated Telegram account already joined to the source channel in the official Telegram app.</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{status.channelTitle || "Choose a broadcast channel"}</p>
                        <p className="text-xs text-muted-foreground">Imports are text and captions only; media is not copied.</p>
                      </div>
                      <Select value={status.channelId || ""} disabled={statusMutation.isPending} onValueChange={(channelId) => statusMutation.mutate({ path: "/settings", method: "PUT", data: { enabled: status.enabled, channelId } })}>
                        <SelectTrigger className="w-full sm:w-64" data-testid="select-telegram-channel"><SelectValue placeholder="Select joined channel" /></SelectTrigger>
                        <SelectContent>{(channelsQuery.data || []).map((channel) => <SelectItem key={channel.id} value={channel.id}>{channel.title}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 lg:justify-end">
                  {status.connected && (
                    <div className="flex items-center gap-2">
                      <Label htmlFor="telegram-import-enabled" className="text-sm">Automatic imports</Label>
                      <Switch id="telegram-import-enabled" checked={status.enabled} disabled={statusMutation.isPending} onCheckedChange={(enabled) => statusMutation.mutate({ path: "/settings", method: "PUT", data: { enabled, ...(status.channelId ? { channelId: status.channelId } : {}) } })} data-testid="switch-telegram-enabled" />
                    </div>
                  )}
                  {status.connected && <Button size="sm" variant="outline" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate({ path: "/disconnect", method: "POST" })} data-testid="button-telegram-disconnect">Disconnect</Button>}
                </div>
                {errorMessage && <p className="col-span-full text-xs text-destructive" role="alert" data-testid="text-telegram-action-error">{errorMessage}</p>}
                {status.lastImportedAt && <p className="col-span-full text-xs text-muted-foreground">Last imported {new Date(status.lastImportedAt).toLocaleString()}</p>}
              </div>
            ) : status && (
              <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3" data-testid="notice-telegram-not-configured">
                <Settings2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">Secure server setup required</p>
                  <p className="text-xs text-muted-foreground">Ask your operator to configure TELEGRAM_API_ID, TELEGRAM_API_HASH, and TELEGRAM_IMPORT_ENCRYPTION_KEY in server secrets. Do not enter these values here.</p>
                </div>
              </div>
            )}
          {isMasterAdmin && status?.configured && status?.lastCheckedAt && (
            <p className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground"><Clock3 className="h-3 w-3" />Checked {new Date(status.lastCheckedAt).toLocaleString()}</p>
          )}
        </div>
      )}

      <div className="p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Pending review <span className="ml-1 font-mono text-xs text-muted-foreground">{draftsQuery.data?.length ?? "—"}</span></h3>
            <p className="mt-1 text-xs text-muted-foreground">Imported posts stay unpublished until an admin reviews and sends them.</p>
          </div>
          {draftsQuery.isFetching && !draftsQuery.isLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Refreshing drafts" />}
        </div>
        {draftsQuery.isLoading ? (
          <div className="space-y-2" data-testid="skeleton-telegram-drafts">{[1, 2].map((row) => <div key={row} className="h-16 animate-pulse rounded-lg bg-muted" />)}</div>
        ) : draftsQuery.isError ? (
          <div className="flex flex-col items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4" data-testid="text-telegram-drafts-error">
            <p className="text-sm text-destructive">Pending imports could not be loaded.</p>
            <Button size="sm" variant="outline" onClick={() => draftsQuery.refetch()} data-testid="button-retry-telegram-drafts">Retry</Button>
          </div>
        ) : draftsQuery.data?.length ? (
          <div className="divide-y divide-border rounded-lg border">
            {draftsQuery.data.map((draft) => (
              <button key={draft.id} type="button" onClick={() => openDraft(draft)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={`button-open-telegram-draft-${draft.id}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{draft.title.trim() || "Untitled imported post"}</span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">{draft.channelTitle} · {new Date(draft.sourcePostedAt).toLocaleDateString()}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">Pending</Badge>
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed px-4 py-8 text-center" data-testid="text-no-telegram-drafts">
            <ShieldCheck className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
            <p className="text-sm font-medium">Nothing waiting for review</p>
            <p className="mt-1 text-xs text-muted-foreground">New channel posts will appear here as private drafts.</p>
          </div>
        )}
      </div>

      <Dialog open={editorOpen} onOpenChange={(open) => { if (!open) closeEditor(); }}>
        <AlertEditorDialogContent data-testid="dialog-telegram-draft" onPointerDownOutside={(event) => event.preventDefault()}>
          <DialogHeader className="shrink-0">
            <DialogTitle>Review imported post</DialogTitle>
          </DialogHeader>
          {draftUnavailable ? (
            <div className="flex min-h-0 flex-1 flex-col justify-center gap-2 py-8 text-center" data-testid="text-telegram-draft-unavailable">
              <AlertTriangle className="mx-auto h-6 w-6 text-amber-600" />
              <p className="text-sm font-medium">This draft is no longer available.</p>
              <p className="text-xs text-muted-foreground">It may have already been published or deleted. The draft cannot be edited here.</p>
              <Button className="mx-auto mt-2" variant="outline" onClick={() => closeEditor(true)} data-testid="button-close-unavailable-draft">Close</Button>
            </div>
          ) : linkedDraftFetchFailed ? (
            <div className="flex min-h-0 flex-1 flex-col justify-center gap-2 py-8 text-center" data-testid="text-telegram-draft-load-error">
              <AlertTriangle className="mx-auto h-6 w-6 text-destructive" />
              <p className="text-sm font-medium">Could not confirm this draft.</p>
              <p className="text-xs text-muted-foreground">Check your connection and retry. No changes have been made.</p>
              <Button className="mx-auto mt-2" variant="outline" disabled={linkedDraftQuery.isFetching} onClick={() => linkedDraftQuery.refetch()} data-testid="button-retry-telegram-draft">
                {linkedDraftQuery.isFetching ? "Retrying…" : "Retry"}
              </Button>
            </div>
          ) : !selectedDraft && linkedDraftQuery.isLoading ? (
            <div className="min-h-0 flex-1 space-y-3 py-4"><div className="h-9 animate-pulse rounded bg-muted" /><div className="h-36 animate-pulse rounded bg-muted" /></div>
          ) : selectedDraft && (
            <form className="flex min-h-0 flex-1 flex-col gap-3" onSubmit={(event) => event.preventDefault()}>
              <AlertEditorScrollArea className="space-y-4">
                <div className="rounded-md bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{selectedDraft.channelTitle}</span>
                  <span> · {new Date(selectedDraft.sourcePostedAt).toLocaleString()}</span>
                  {selectedDraft.sourceUrl && <a href={selectedDraft.sourceUrl} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 underline underline-offset-2">Source <ExternalLink className="h-3 w-3" /></a>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="telegram-draft-service">Service</Label>
                  <Select value={fields.serviceId} onValueChange={(serviceId) => setFields((current) => ({ ...current, serviceId }))}>
                    <SelectTrigger id="telegram-draft-service" data-testid="select-telegram-draft-service"><SelectValue placeholder="Choose a service" /></SelectTrigger>
                    <SelectContent>{(servicesQuery.data || []).map((service) => <SelectItem key={service.id} value={service.id}>{service.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="telegram-draft-title">Title</Label>
                  <Input id="telegram-draft-title" value={fields.title} onChange={(event) => setFields((current) => ({ ...current, title: event.target.value }))} placeholder="Add a clear update title" data-testid="input-telegram-draft-title" />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <RichTextEditor value={fields.description} onChange={(description) => setFields((current) => ({ ...current, description }))} placeholder="Review and refine the imported post…" testIdPrefix="input-telegram-draft-description" hideImage />
                </div>
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div><Label htmlFor="telegram-draft-mature">Mature content</Label><p className="text-xs text-muted-foreground">Warn customers before viewing this update</p></div>
                  <Switch id="telegram-draft-mature" checked={fields.matureContent} onCheckedChange={(matureContent) => setFields((current) => ({ ...current, matureContent }))} data-testid="switch-telegram-draft-mature" />
                </div>
              </AlertEditorScrollArea>
              <AlertEditorActions className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_auto_auto]">
                <Button type="button" variant="outline" className="col-span-2 sm:col-span-1" disabled={draftMutationPending || !canManage} onClick={() => selectedId && saveDraft.mutate({ id: selectedId, values: fields })} data-testid="button-save-telegram-draft">
                  {saveDraft.isPending ? "Saving…" : <><Check className="mr-1.5 h-4 w-4" />Save for later</>}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild><Button type="button" variant="outline" className="text-destructive hover:text-destructive" disabled={!canManage || draftMutationPending} data-testid="button-delete-telegram-draft"><Trash2 className="mr-1.5 h-4 w-4" />Delete</Button></AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader><AlertDialogTitle>Delete this imported draft?</AlertDialogTitle><AlertDialogDescription>This removes the unpublished draft. No subscriber notification will be sent.</AlertDialogDescription></AlertDialogHeader>
                    <AlertDialogFooter><AlertDialogCancel data-testid="button-cancel-delete-telegram-draft">Keep draft</AlertDialogCancel><AlertDialogAction disabled={draftMutationPending} onClick={() => selectedId && deleteDraft.mutate(selectedId)} data-testid="button-confirm-delete-telegram-draft">Delete draft</AlertDialogAction></AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <Button type="button" disabled={!canManage || !validPublish || draftMutationPending} onClick={() => selectedId && publishDraft.mutate({ id: selectedId, values: fields })} data-testid="button-publish-telegram-draft">
                  {publishDraft.isPending ? "Publishing…" : <><Send className="mr-1.5 h-4 w-4" />Publish &amp; Notify</>}
                </Button>
              </AlertEditorActions>
            </form>
          )}
        </AlertEditorDialogContent>
      </Dialog>
      <AlertDialog open={discardEditsOpen} onOpenChange={setDiscardEditsOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>Your last saved draft will remain available. Changes since your last save will be lost.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-keep-editing-telegram-draft">Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={() => closeEditor(true)} data-testid="button-discard-telegram-draft-edits">Discard changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
