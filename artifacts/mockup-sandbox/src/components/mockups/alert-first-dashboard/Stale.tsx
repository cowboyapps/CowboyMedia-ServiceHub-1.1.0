import "./_group.css";
import { PreviewShell } from "./_Shell";
import { AlertFirst } from "./_AlertFirst";

export function Stale() {
  return <PreviewShell label="Out-of-date status · sample data"><AlertFirst example="stale" /></PreviewShell>;
}
