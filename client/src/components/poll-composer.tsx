import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { serverActionErrorMessage } from "@/lib/server-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, X, BarChart3 } from "lucide-react";

export interface PollDraft {
  question: string;
  options: string[];
  multiSelect: boolean;
  closesAt: string | null;
}

export function emptyPollDraft(): PollDraft {
  return { question: "", options: ["", ""], multiSelect: false, closesAt: null };
}

export function isPollDraftValid(draft: PollDraft): boolean {
  if (!draft.question.trim()) return false;
  const filled = draft.options.map(o => o.trim()).filter(o => o.length > 0);
  return filled.length >= 2 && filled.length <= 6;
}

export function PollEditor({ value, onChange }: { value: PollDraft; onChange: (next: PollDraft) => void }) {
  const update = (patch: Partial<PollDraft>) => onChange({ ...value, ...patch });

  const setOption = (i: number, text: string) => {
    const next = [...value.options];
    next[i] = text;
    update({ options: next });
  };
  const addOption = () => {
    if (value.options.length >= 6) return;
    update({ options: [...value.options, ""] });
  };
  const removeOption = (i: number) => {
    if (value.options.length <= 2) return;
    update({ options: value.options.filter((_, idx) => idx !== i) });
  };

  return (
    <div className="space-y-3 rounded-md border p-3 bg-muted/20">
      <div className="flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">Poll</span>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Question</Label>
        <Input
          value={value.question}
          onChange={(e) => update({ question: e.target.value })}
          placeholder="What do you think?"
          maxLength={500}
          data-testid="input-poll-question"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Options (2–6)</Label>
        {value.options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={opt}
              onChange={(e) => setOption(i, e.target.value)}
              placeholder={`Option ${i + 1}`}
              maxLength={200}
              data-testid={`input-poll-option-${i}`}
            />
            {value.options.length > 2 && (
              <Button type="button" size="icon" variant="ghost" onClick={() => removeOption(i)} data-testid={`button-remove-poll-option-${i}`}>
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
        ))}
        {value.options.length < 6 && (
          <Button type="button" size="sm" variant="outline" onClick={addOption} data-testid="button-add-poll-option">
            <Plus className="w-3.5 h-3.5 mr-1" /> Add option
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="poll-multi"
          checked={value.multiSelect}
          onCheckedChange={(v) => update({ multiSelect: !!v })}
          data-testid="checkbox-poll-multi"
        />
        <Label htmlFor="poll-multi" className="text-sm font-normal cursor-pointer">
          Allow multiple selections
        </Label>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Closes at (optional)</Label>
        <Input
          type="datetime-local"
          value={value.closesAt ? toLocalDatetime(value.closesAt) : ""}
          onChange={(e) => {
            if (!e.target.value) {
              update({ closesAt: null });
            } else {
              update({ closesAt: new Date(e.target.value).toISOString() });
            }
          }}
          data-testid="input-poll-closes-at"
        />
      </div>
    </div>
  );
}

function toLocalDatetime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function submitPollDraft(draft: PollDraft, parentType: "news" | "community", parentId?: string) {
  const cleaned = {
    parentType,
    parentId,
    question: draft.question.trim(),
    multiSelect: draft.multiSelect,
    closesAt: draft.closesAt,
    options: draft.options.map(o => o.trim()).filter(o => o.length > 0),
  };
  const res = await apiRequest("POST", "/api/polls", cleaned);
  return res.json();
}

export function PollComposerDialog({
  open,
  onOpenChange,
  parentType,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentType: "community";
  onCreated?: (poll: any) => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<PollDraft>(emptyPollDraft());

  const createMutation = useMutation({
    mutationFn: () => submitPollDraft(draft, parentType),
    onSuccess: (poll) => {
      toast({ title: "Poll posted" });
      queryClient.invalidateQueries({ queryKey: ["/api/community-chat/messages"] });
      setDraft(emptyPollDraft());
      onOpenChange(false);
      onCreated?.(poll);
    },
    onError: (e: Error) => toast({ title: "Failed to post poll", description: serverActionErrorMessage(e, "Couldn't post the poll. Please try again."), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setDraft(emptyPollDraft()); onOpenChange(v); }}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Post a Poll</DialogTitle></DialogHeader>
        <PollEditor value={draft} onChange={setDraft} />
        <Button
          onClick={() => createMutation.mutate()}
          disabled={!isPollDraftValid(draft) || createMutation.isPending}
          data-testid="button-submit-poll"
        >
          {createMutation.isPending ? "Posting..." : "Post Poll"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
