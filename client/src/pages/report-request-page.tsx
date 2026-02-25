import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { AlertTriangle, Film, CheckCircle, Clock } from "lucide-react";
import { format } from "date-fns";
import type { Service, ReportRequest } from "@shared/schema";

type EnrichedReportRequest = ReportRequest & { serviceName?: string };

const contentIssueSchema = z.object({
  serviceId: z.string().min(1, "Service is required"),
  title: z.string().min(1, "Content title is required"),
  description: z.string().min(1, "Issue description is required"),
});

const movieRequestSchema = z.object({
  serviceId: z.string().min(1, "Service is required"),
  title: z.string().min(1, "Movie or series title is required"),
  description: z.string().optional(),
});

export default function ReportRequestPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeForm, setActiveForm] = useState<"content_issue" | "movie_request" | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const { data: submissions, isLoading } = useQuery<EnrichedReportRequest[]>({
    queryKey: ["/api/report-requests"],
  });

  const contentForm = useForm({
    resolver: zodResolver(contentIssueSchema),
    defaultValues: { serviceId: "", title: "", description: "" },
  });

  const movieForm = useForm({
    resolver: zodResolver(movieRequestSchema),
    defaultValues: { serviceId: "", title: "", description: "" },
  });

  const submitMutation = useMutation({
    mutationFn: async (data: { type: string; serviceId: string; title: string; description?: string }) => {
      const res = await apiRequest("POST", "/api/report-requests", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/report-requests"] });
      setActiveForm(null);
      contentForm.reset();
      movieForm.reset();
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 4000);
    },
    onError: (e: Error) => {
      toast({ title: "Failed to submit", description: e.message, variant: "destructive" });
    },
  });

  const handleContentSubmit = (data: z.infer<typeof contentIssueSchema>) => {
    submitMutation.mutate({ type: "content_issue", ...data });
  };

  const handleMovieSubmit = (data: z.infer<typeof movieRequestSchema>) => {
    submitMutation.mutate({ type: "movie_request", ...data, description: data.description || "" });
  };

  const statusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      pending: "secondary",
      reviewed: "default",
      completed: "default",
      dismissed: "outline",
    };
    return <Badge variant={variants[status] || "secondary"} className="text-xs capitalize" data-testid={`badge-status-${status}`}>{status}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-report-request-title">Report / Request</h1>
        <p className="text-sm text-muted-foreground mt-1">Report content issues or request movies and series</p>
      </div>

      {showSuccess && (
        <Card className="border-green-500/50 bg-green-500/10">
          <CardContent className="p-4 flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
            <div>
              <p className="font-medium text-sm" data-testid="text-submission-success">Submission sent successfully!</p>
              <p className="text-xs text-muted-foreground">A confirmation email has been sent to your email address.</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          onClick={() => { setActiveForm("content_issue"); contentForm.reset(); }}
          className="flex flex-col items-center justify-center gap-3 p-8 rounded-xl border bg-card hover:bg-accent/50 transition-colors active:scale-[0.97] focus:outline-none focus:ring-2 focus:ring-ring"
          data-testid="button-report-content"
        >
          <div className="rounded-full p-4 bg-red-500/10">
            <AlertTriangle className="w-8 h-8 text-red-500" />
          </div>
          <span className="font-semibold">Report Content Issue</span>
          <span className="text-xs text-muted-foreground text-center">Report a problem with content on a service</span>
        </button>

        <button
          onClick={() => { setActiveForm("movie_request"); movieForm.reset(); }}
          className="flex flex-col items-center justify-center gap-3 p-8 rounded-xl border bg-card hover:bg-accent/50 transition-colors active:scale-[0.97] focus:outline-none focus:ring-2 focus:ring-ring"
          data-testid="button-request-movie"
        >
          <div className="rounded-full p-4 bg-blue-500/10">
            <Film className="w-8 h-8 text-blue-500" />
          </div>
          <span className="font-semibold">Request Movie/Series</span>
          <span className="text-xs text-muted-foreground text-center">Request a movie or series to be added</span>
        </button>
      </div>

      <Dialog open={activeForm === "content_issue"} onOpenChange={(open) => { if (!open) setActiveForm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report Content Issue</DialogTitle>
          </DialogHeader>
          <Form {...contentForm}>
            <form onSubmit={contentForm.handleSubmit(handleContentSubmit)} className="space-y-4">
              <FormField control={contentForm.control} name="serviceId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Service</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-service-content">
                        <SelectValue placeholder="Select a service" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {services?.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={contentForm.control} name="title" render={({ field }) => (
                <FormItem>
                  <FormLabel>Title of Content</FormLabel>
                  <FormControl><Input {...field} placeholder="e.g. Breaking Bad S01E03" data-testid="input-content-title" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={contentForm.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Issue Description</FormLabel>
                  <FormControl><Textarea {...field} rows={3} placeholder="Describe the issue..." data-testid="input-content-description" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <Button type="submit" className="w-full" disabled={submitMutation.isPending} data-testid="button-submit-content-issue">
                {submitMutation.isPending ? "Submitting..." : "Submit Report"}
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={activeForm === "movie_request"} onOpenChange={(open) => { if (!open) setActiveForm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Movie/Series</DialogTitle>
          </DialogHeader>
          <Form {...movieForm}>
            <form onSubmit={movieForm.handleSubmit(handleMovieSubmit)} className="space-y-4">
              <FormField control={movieForm.control} name="serviceId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Service</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-service-movie">
                        <SelectValue placeholder="Select a service" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {services?.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={movieForm.control} name="title" render={({ field }) => (
                <FormItem>
                  <FormLabel>Movie or Series Title</FormLabel>
                  <FormControl><Input {...field} placeholder="e.g. The Bear" data-testid="input-movie-title" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={movieForm.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (optional)</FormLabel>
                  <FormControl><Textarea {...field} rows={3} placeholder="Any additional details..." data-testid="input-movie-notes" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <Button type="submit" className="w-full" disabled={submitMutation.isPending} data-testid="button-submit-movie-request">
                {submitMutation.isPending ? "Submitting..." : "Submit Request"}
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : submissions && submissions.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold" data-testid="text-my-submissions">My Submissions</h2>
          {submissions.map((sub) => (
            <Card key={sub.id} data-testid={`card-submission-${sub.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={sub.type === "content_issue" ? "destructive" : "default"} className="text-xs">
                        {sub.type === "content_issue" ? "Content Issue" : "Movie/Series Request"}
                      </Badge>
                      {statusBadge(sub.status)}
                    </div>
                    <p className="font-medium text-sm mt-2" data-testid={`text-submission-title-${sub.id}`}>{sub.title}</p>
                    {sub.description && <p className="text-xs text-muted-foreground mt-1">{sub.description}</p>}
                    <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                      <span>{sub.serviceName}</span>
                      <span>·</span>
                      <Clock className="w-3 h-3" />
                      <span>{format(new Date(sub.createdAt), "MMM d, yyyy")}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
