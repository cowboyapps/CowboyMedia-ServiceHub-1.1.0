import { useEffect, useState } from "react";
import { Film, FileText } from "lucide-react";

/** Local preview only; never misrepresent a staged file as a saved upload. */
export function PendingTicketAttachment({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file.type.startsWith("image/") || typeof URL.createObjectURL !== "function") return;
    const preview = URL.createObjectURL(file);
    setUrl(preview);
    return () => { URL.revokeObjectURL(preview); };
  }, [file]);
  return (
    <div className="mt-1 flex min-w-0 items-center gap-2 text-xs" data-testid="pending-ticket-attachment">
      {file.type.startsWith("image/") && url
        ? <img src={url} alt="Unsent image preview" className="h-16 w-20 rounded-lg object-cover" />
        : file.type.startsWith("video/") ? <Film className="h-7 w-7 shrink-0" /> : <FileText className="h-6 w-6 shrink-0" />}
      <span className="min-w-0 truncate">{file.name}</span>
    </div>
  );
}
