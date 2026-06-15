import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ShieldCheck, ShieldAlert, Download, Copy, Check } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { serverActionErrorMessage } from "@/lib/server-error";
import { useToast } from "@/hooks/use-toast";

interface StatusResponse {
  enabled: boolean;
  enabledAt: string | null;
  setupPending: boolean;
  remainingBackupCodes: number;
}

interface SetupResponse {
  secret: string;
  otpauth: string;
  qrDataUrl: string;
}

type Stage = "idle" | "setup" | "activated" | "disable" | "regenerate";

export function TwoFactorSecurityCard() {
  const { toast } = useToast();
  const [stage, setStage] = useState<Stage>("idle");
  const [setupData, setSetupData] = useState<SetupResponse | null>(null);
  const [activateCode, setActivateCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [acknowledgedBackup, setAcknowledgedBackup] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [regeneratePassword, setRegeneratePassword] = useState("");
  const [regenerateCode, setRegenerateCode] = useState("");
  const [copiedCodes, setCopiedCodes] = useState(false);

  const { data: status, isLoading } = useQuery<StatusResponse>({
    queryKey: ["/api/auth/2fa/status"],
  });

  const startSetup = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/2fa/setup");
      return (await res.json()) as SetupResponse;
    },
    onSuccess: (data) => {
      setSetupData(data);
      setStage("setup");
      setActivateCode("");
    },
    onError: (e: Error) => toast({ title: "Couldn't start setup", description: serverActionErrorMessage(e, "Couldn't start two-factor setup. Please try again."), variant: "destructive" }),
  });

  const activate = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/2fa/activate", { code: activateCode });
      return (await res.json()) as { backupCodes: string[] };
    },
    onSuccess: (data) => {
      setBackupCodes(data.backupCodes);
      setStage("activated");
      setAcknowledgedBackup(false);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/2fa/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (e: Error) => toast({ title: "Activation failed", description: serverActionErrorMessage(e, "Couldn't activate two-factor authentication. Please try again."), variant: "destructive" }),
  });

  const disable = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/2fa/disable", { password: disablePassword, code: disableCode });
    },
    onSuccess: () => {
      toast({ title: "2FA disabled" });
      setStage("idle");
      setDisablePassword("");
      setDisableCode("");
      setSetupData(null);
      setBackupCodes(null);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/2fa/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (e: Error) => toast({ title: "Could not disable 2FA", description: serverActionErrorMessage(e, "Couldn't disable two-factor authentication. Please try again."), variant: "destructive" }),
  });

  const regenerate = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/2fa/backup-codes/regenerate", { password: regeneratePassword, code: regenerateCode });
      return (await res.json()) as { backupCodes: string[] };
    },
    onSuccess: (data) => {
      setBackupCodes(data.backupCodes);
      setStage("activated");
      setAcknowledgedBackup(false);
      setRegeneratePassword("");
      setRegenerateCode("");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/2fa/status"] });
    },
    onError: (e: Error) => toast({ title: "Couldn't regenerate codes", description: serverActionErrorMessage(e, "Couldn't regenerate your backup codes. Please try again."), variant: "destructive" }),
  });

  const closeAndReset = () => {
    setStage("idle");
    setSetupData(null);
    setActivateCode("");
    setBackupCodes(null);
    setAcknowledgedBackup(false);
    setDisablePassword("");
    setDisableCode("");
    setRegeneratePassword("");
    setRegenerateCode("");
  };

  const downloadCodes = () => {
    if (!backupCodes) return;
    const text = `ServiceHub 2FA backup codes\nGenerated ${new Date().toISOString()}\n\nKeep these somewhere safe. Each code can be used once.\n\n${backupCodes.join("\n")}\n`;
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "servicehub-2fa-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
    setAcknowledgedBackup(true);
  };

  const copyCodes = async () => {
    if (!backupCodes) return;
    await navigator.clipboard.writeText(backupCodes.join("\n"));
    setCopiedCodes(true);
    setAcknowledgedBackup(true);
    setTimeout(() => setCopiedCodes(false), 2000);
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" />
            Two-factor authentication
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : status?.enabled ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium flex items-center gap-2">
                    Enabled <Badge variant="secondary" className="text-[10px]" data-testid="badge-2fa-enabled">ACTIVE</Badge>
                  </p>
                  <p className="text-xs text-muted-foreground" data-testid="text-2fa-status">
                    {status.remainingBackupCodes} backup code{status.remainingBackupCodes === 1 ? "" : "s"} remaining
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setStage("regenerate")}
                    data-testid="button-regenerate-backup-codes"
                  >
                    Regenerate codes
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setStage("disable")}
                    data-testid="button-disable-2fa"
                  >
                    Disable
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Add a second sign-in step using an authenticator app like Google Authenticator, Authy, or 1Password.
              </p>
              <Button
                size="sm"
                onClick={() => startSetup.mutate()}
                disabled={startSetup.isPending}
                data-testid="button-enable-2fa"
              >
                <ShieldCheck className="w-4 h-4 mr-1.5" />
                {startSetup.isPending ? "Starting…" : "Enable 2FA"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={stage === "setup"} onOpenChange={(o) => { if (!o) closeAndReset(); }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md" data-testid="dialog-2fa-setup">
          <DialogHeader>
            <DialogTitle>Set up two-factor authentication</DialogTitle>
            <DialogDescription>
              Scan this QR code in your authenticator app, then enter the 6-digit code below to activate.
            </DialogDescription>
          </DialogHeader>
          {setupData && (
            <div className="space-y-3">
              <div className="flex justify-center">
                <img src={setupData.qrDataUrl} alt="2FA QR code" className="w-48 h-48 border rounded" data-testid="img-2fa-qr" />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Or enter this secret manually:</p>
                <code className="block text-xs bg-muted p-2 rounded break-all" data-testid="text-2fa-secret">{setupData.secret}</code>
              </div>
              <Input
                placeholder="6-digit code"
                inputMode="numeric"
                value={activateCode}
                onChange={(e) => setActivateCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                data-testid="input-2fa-activate-code"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={closeAndReset}>Cancel</Button>
            <Button
              onClick={() => activate.mutate()}
              disabled={activateCode.length !== 6 || activate.isPending}
              data-testid="button-2fa-activate"
            >
              {activate.isPending ? "Activating…" : "Activate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={stage === "activated"} onOpenChange={(o) => { if (!o && acknowledgedBackup) closeAndReset(); }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md" data-testid="dialog-2fa-backup-codes">
          <DialogHeader>
            <DialogTitle>Save your backup codes</DialogTitle>
            <DialogDescription>
              These backup codes let you sign in if you lose access to your authenticator app. Each code works once. Save them now — you won't see them again.
            </DialogDescription>
          </DialogHeader>
          {backupCodes && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 p-3 bg-muted rounded font-mono text-sm" data-testid="list-backup-codes">
                {backupCodes.map((c) => (
                  <div key={c} data-testid={`text-backup-code-${c}`}>{c}</div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={copyCodes} data-testid="button-copy-backup-codes">
                  {copiedCodes ? <Check className="w-4 h-4 mr-1.5" /> : <Copy className="w-4 h-4 mr-1.5" />}
                  {copiedCodes ? "Copied" : "Copy"}
                </Button>
                <Button variant="outline" size="sm" onClick={downloadCodes} data-testid="button-download-backup-codes">
                  <Download className="w-4 h-4 mr-1.5" />
                  Download
                </Button>
              </div>
              {!acknowledgedBackup && (
                <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <ShieldAlert className="w-3.5 h-3.5" /> Copy or download the codes before closing this dialog.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={closeAndReset} disabled={!acknowledgedBackup} data-testid="button-finish-2fa-setup">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={stage === "regenerate"} onOpenChange={(o) => { if (!o) closeAndReset(); }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md" data-testid="dialog-2fa-regenerate">
          <DialogHeader>
            <DialogTitle>Regenerate backup codes</DialogTitle>
            <DialogDescription>
              Confirm your password and a current 6-digit code to replace your existing backup codes. Your old codes will stop working immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="password"
              placeholder="Current password"
              value={regeneratePassword}
              onChange={(e) => setRegeneratePassword(e.target.value)}
              data-testid="input-regenerate-password"
            />
            <Input
              placeholder="6-digit code"
              inputMode="numeric"
              value={regenerateCode}
              onChange={(e) => setRegenerateCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              data-testid="input-regenerate-code"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={closeAndReset}>Cancel</Button>
            <Button
              onClick={() => regenerate.mutate()}
              disabled={!regeneratePassword || regenerateCode.length !== 6 || regenerate.isPending}
              data-testid="button-confirm-regenerate-backup-codes"
            >
              {regenerate.isPending ? "Regenerating…" : "Regenerate codes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={stage === "disable"} onOpenChange={(o) => { if (!o) closeAndReset(); }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md" data-testid="dialog-2fa-disable">
          <DialogHeader>
            <DialogTitle>Disable two-factor authentication</DialogTitle>
            <DialogDescription>
              Confirm your password and a current 6-digit code from your authenticator app to disable 2FA.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="password"
              placeholder="Current password"
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              data-testid="input-disable-password"
            />
            <Input
              placeholder="6-digit code"
              inputMode="numeric"
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              data-testid="input-disable-code"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={closeAndReset}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => disable.mutate()}
              disabled={!disablePassword || disableCode.length !== 6 || disable.isPending}
              data-testid="button-confirm-disable-2fa"
            >
              {disable.isPending ? "Disabling…" : "Disable 2FA"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
