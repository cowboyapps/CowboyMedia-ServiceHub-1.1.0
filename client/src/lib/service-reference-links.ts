export type ServiceReference = { kind: "alert" | "update"; id: string; title: string };

/** Relative URLs keep shared references on the customer's current ServiceHub. */
export function serviceReferencePath(reference: Pick<ServiceReference, "kind" | "id">): string {
  return reference.kind === "alert"
    ? `/alerts/${encodeURIComponent(reference.id)}`
    : `/service-updates?highlight=${encodeURIComponent(reference.id)}`;
}

export function appendServiceReference(draft: string, reference: ServiceReference): string {
  const title = reference.title.replace(/\s+/g, " ").trim();
  const label = reference.kind === "alert" ? "Service alert" : "Service update";
  const text = `${label}: ${title}\n${serviceReferencePath(reference)}`;
  return draft.trim() ? `${draft.trimEnd()}\n\n${text}` : text;
}
