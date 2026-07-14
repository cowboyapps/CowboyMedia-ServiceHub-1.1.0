import { AlertTriangle, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-dvh w-full flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
        <div className="p-8 text-center space-y-6">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full bg-status-away/10 flex items-center justify-center">
              <AlertTriangle className="h-8 w-8 text-status-away" />
            </div>
          </div>
          
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-foreground">404 Page Not Found</h1>
            <p className="text-sm text-muted-foreground">
              The page you're looking for doesn't exist or has been moved.
            </p>
          </div>
          
          <div className="pt-2">
            <Link href="/">
              <Button className="w-full gap-2">
                <ArrowLeft className="w-4 h-4" />
                Back to Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
