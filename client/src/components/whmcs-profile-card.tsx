import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { UserCog } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { queryClient, apiRequest, liveQueryOptions } from "@/lib/queryClient";
import { serverActionErrorMessage } from "@/lib/server-error";
import { useToast } from "@/hooks/use-toast";
import { updateWhmcsProfileSchema, type UpdateWhmcsProfileData } from "@shared/schema";

interface WhmcsProfile {
  firstName: string;
  lastName: string;
  companyName: string;
  email: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  phoneNumber: string;
}

interface ProfilePayload {
  configured: boolean;
  enabled: boolean;
  linked: boolean;
  unreachable: boolean;
  profile: WhmcsProfile | null;
}

const EMPTY: UpdateWhmcsProfileData = {
  firstName: "",
  lastName: "",
  companyName: "",
  email: "",
  address1: "",
  address2: "",
  city: "",
  state: "",
  postcode: "",
  country: "",
  phoneNumber: "",
};

function toFormValues(p: WhmcsProfile): UpdateWhmcsProfileData {
  return {
    firstName: p.firstName,
    lastName: p.lastName,
    companyName: p.companyName,
    email: p.email,
    address1: p.address1,
    address2: p.address2,
    city: p.city,
    state: p.state,
    postcode: p.postcode,
    country: p.country,
    phoneNumber: p.phoneNumber,
  };
}

export function WhmcsProfileCard() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<ProfilePayload>({
    queryKey: ["/api/billing/profile"],
    ...liveQueryOptions,
  });

  const form = useForm<UpdateWhmcsProfileData>({
    resolver: zodResolver(updateWhmcsProfileSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (data?.profile) {
      form.reset(toFormValues(data.profile));
    }
  }, [data?.profile, form]);

  const saveMutation = useMutation({
    mutationFn: async (values: UpdateWhmcsProfileData) => {
      const res = await apiRequest("PATCH", "/api/billing/profile", values);
      return res.json() as Promise<{ ok: boolean; profile: WhmcsProfile | null; message?: string }>;
    },
    onSuccess: (result) => {
      if (result.profile) {
        form.reset(toFormValues(result.profile));
      }
      queryClient.invalidateQueries({ queryKey: ["/api/billing/profile"] });
      toast({ title: "Account details saved" });
    },
    onError: (e: Error) => {
      toast({ title: "Couldn't save your details", description: serverActionErrorMessage(e, "Couldn't save your details. Please try again."), variant: "destructive" });
    },
  });

  // Loading skeleton while the first fetch is in flight.
  if (isLoading) {
    return <Skeleton className="h-64 rounded-xl" data-testid="whmcs-profile-loading" />;
  }

  // Hide entirely when WHMCS isn't wired up or this user isn't linked — exactly
  // like the read-only billing surfaces. Nothing to edit, so nothing to show.
  if (!data || !data.configured || !data.enabled || !data.linked) return null;

  // Linked but WHMCS is unreachable / the record couldn't be read: show a small
  // informative state instead of a broken form.
  if (data.unreachable || !data.profile) {
    return (
      <Card data-testid="card-whmcs-profile-unreachable">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <UserCog className="w-4 h-4" /> Account details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground" data-testid="text-whmcs-profile-unreachable">
            We couldn't load your account details right now. Please try again shortly.
          </p>
        </CardContent>
      </Card>
    );
  }

  const onSubmit = (values: UpdateWhmcsProfileData) => saveMutation.mutate(values);
  const saving = saveMutation.isPending;

  return (
    <Card data-testid="card-whmcs-profile">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <UserCog className="w-4 h-4" /> Account details
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-4">
          Update the contact details on your billing account. Changes are saved straight to your account.
        </p>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First name</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} data-testid="input-profile-firstname" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last name</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} data-testid="input-profile-lastname" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="companyName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Company (optional)</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} data-testid="input-profile-company" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" {...field} value={field.value ?? ""} data-testid="input-profile-email" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phoneNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} data-testid="input-profile-phone" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="address1"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address line 1</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} data-testid="input-profile-address1" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="address2"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address line 2 (optional)</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} data-testid="input-profile-address2" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>City</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} data-testid="input-profile-city" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="state"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>State / region</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} data-testid="input-profile-state" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="postcode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Postal code</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} data-testid="input-profile-postcode" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="country"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Country code</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ""}
                        maxLength={2}
                        placeholder="e.g. US"
                        data-testid="input-profile-country"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={saving || !form.formState.isDirty} data-testid="button-save-profile">
                {saving ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
