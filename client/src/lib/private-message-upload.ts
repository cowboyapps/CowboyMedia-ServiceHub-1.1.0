import { uploadRequest, TimeoutError } from "./queryClient";
import { PRIVATE_UPLOAD_TIMEOUT_MS } from "@shared/private-message-uploads";

/** XHR exposes real upload progress; fetch does not. Keep request IDs supplied
 * by the caller so an interrupted transfer can be retried without duplicates. */
export function uploadPrivateMessage(url: string, form: FormData, progress: (percent: number) => void): Promise<Response> {
  if (typeof XMLHttpRequest === "undefined") {
    return uploadRequest("POST", url, form, { timeoutMs: PRIVATE_UPLOAD_TIMEOUT_MS });
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let idle: ReturnType<typeof setTimeout> | undefined;
    let stalled = false;
    const clear = () => { if (idle) clearTimeout(idle); };
    const active = () => {
      clear();
      idle = setTimeout(() => { stalled = true; xhr.abort(); }, 180_000);
    };
    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.timeout = PRIVATE_UPLOAD_TIMEOUT_MS;
    xhr.upload.onprogress = event => {
      active();
      if (event.lengthComputable && event.total > 0) progress(Math.round(event.loaded * 100 / event.total));
    };
    xhr.upload.onload = () => { clear(); progress(100); };
    xhr.onload = () => {
      clear();
      try {
        if (!xhr.status) throw new Error("The upload connection closed without a response. Your draft is available to retry.");
        resolve(new Response(xhr.status === 204 ? null : xhr.responseText, { status: xhr.status, headers: { "Content-Type": xhr.getResponseHeader("Content-Type") || "text/plain" } }));
      } catch (error) { reject(error); }
    };
    xhr.onerror = () => { clear(); reject(new Error("The upload connection failed. Your draft is still available to retry.")); };
    xhr.ontimeout = () => { clear(); reject(new TimeoutError("The upload timed out. Your draft is still available to retry.")); };
    xhr.onabort = () => { clear(); reject(stalled ? new TimeoutError("The upload stopped making progress. Check your connection and retry.") : new Error("Upload cancelled. Your draft has not been cleared.")); };
    active();
    try { xhr.send(form); } catch (error) { clear(); reject(error); }
  });
}
