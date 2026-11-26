import { test } from "node:test";
import assert from "node:assert/strict";
import { Api, TelegramClient } from "teleproto";
import { PhoneMigrateError, FloodWaitError } from "teleproto/errors";
import { TelegramImportTransport } from "./telegram-import-transport";

type RequestState = {
  request: unknown;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

function fixture(reply: (state: RequestState) => void) {
  // Synthetic credentials exist only in this isolated test subprocess.
  process.env.TELEGRAM_API_ID = "12345";
  process.env.TELEGRAM_API_HASH = "0123456789abcdef0123456789abcdef";
  const transport = new TelegramImportTransport("");
  const client = (transport as unknown as { client: TelegramClient }).client;
  const internals = client as unknown as {
    _connectedDeferred: { resolve: () => void };
    _sender: { userDisconnected: boolean; addStateToQueue: (state: RequestState) => void; disconnect: () => Promise<void> };
    _switchDC: (id: number) => Promise<void>;
  };
  const switched: number[] = [];
  // Exercise Teleproto's real RPC retry/migration policies, replacing only
  // the network sender. No connection, login code, or provider call is made.
  internals._sender = { userDisconnected: false, addStateToQueue: reply, disconnect: async () => {} };
  internals._connectedDeferred.resolve();
  internals._switchDC = async id => { switched.push(id); };
  client.isUserAuthorized = async () => false;
  return { transport, switched };
}

test("code request follows Telegram's phone data-center redirect and retains the resulting code hash", async () => {
  let requests = 0;
  const { transport, switched } = fixture(state => {
    requests++;
    if (requests === 1) {
      state.reject(new PhoneMigrateError({ capture: 2, request: state.request }));
    } else {
      state.resolve(new Api.auth.SentCode({
        type: new Api.auth.SentCodeTypeApp({ length: 5 }),
        phoneCodeHash: "synthetic-code-hash",
      }));
    }
  });
  try {
    await transport.startLogin("+15555550000");
    assert.deepEqual(switched, [2], "the SDK switched to the account's home data center");
    assert.equal(requests, 2, "the code request was retried after switching");
    assert.equal((transport as unknown as { phoneCodeHash: string }).phoneCodeHash, "synthetic-code-hash");
  } finally { await transport.close(); }
});

test("enabling migration recovery does not retry or sleep through Telegram flood limits", async () => {
  let requests = 0;
  const { transport, switched } = fixture(state => {
    requests++;
    state.reject(new FloodWaitError({ capture: 60, request: state.request }));
  });
  try {
    await assert.rejects(transport.startLogin("+15555550000"), FloodWaitError);
    assert.equal(requests, 1);
    assert.deepEqual(switched, []);
  } finally { await transport.close(); }
});

test("repeated data-center redirects have a bounded retry budget", async () => {
  let requests = 0;
  const { transport, switched } = fixture(state => {
    requests++;
    state.reject(new PhoneMigrateError({ capture: 2, request: state.request }));
  });
  try {
    await assert.rejects(transport.startLogin("+15555550000"), PhoneMigrateError);
    assert.equal(requests, 3, "a permanently failing redirect cannot loop indefinitely");
    assert.deepEqual(switched, [2, 2]);
  } finally { await transport.close(); }
});
