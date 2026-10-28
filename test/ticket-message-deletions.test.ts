import { test, after } from "node:test";
import assert from "node:assert/strict";
import { queryClient } from "../client/src/lib/queryClient";
import { applyTicketMessageDeletion, withoutDeletedTicketMessages, ticketMessagesQueryFn } from "../client/src/lib/ticket-message-deletions";
after(() => queryClient.clear());
test("deletion removes cached message and filters delayed reads and frames, preserving others", async () => {
  const key = ["/api/tickets", "delete-test", "messages"];
  const original = [{ id: "gone", message: "delete me" }, { id: "kept", message: "keep me" }];
  queryClient.setQueryData(key, original);
  await applyTicketMessageDeletion("delete-test", "gone");
  assert.deepEqual(queryClient.getQueryData(key), [original[1]]);
  assert.deepEqual(withoutDeletedTicketMessages("delete-test", original), [original[1]]);
  assert.deepEqual(withoutDeletedTicketMessages("different-ticket", original), original);
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(original), { status: 200 });
  try {
    const result = await queryClient.fetchQuery({ queryKey: key, queryFn: ticketMessagesQueryFn });
    assert.deepEqual(result, [original[1]], "stale network response cannot resurrect a deleted row");
  } finally { globalThis.fetch = fetchBefore; }
});
