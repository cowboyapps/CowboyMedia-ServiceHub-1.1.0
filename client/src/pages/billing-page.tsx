import { useQuery } from "@tanstack/react-query";
import { BillingSummaryView, type BillingSummary } from "@/components/billing-summary";

export default function BillingPage() {
  const { data, isLoading } = useQuery<BillingSummary>({
    queryKey: ["/api/billing"],
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-billing-title">Billing</h1>
        <p className="text-sm text-muted-foreground mt-1">Your invoices, services, and account balance</p>
      </div>

      <BillingSummaryView data={data} isLoading={isLoading} context="customer" />
    </div>
  );
}
