import type { ScheduleKind } from "@/lib/scheduleInsights";
import { KIND_MARK } from "./scheduleKindStyle";

export function ScheduleKindMark({ kind }: { kind: ScheduleKind }) {
  return <span aria-hidden="true" className={`inline-block shrink-0 ${KIND_MARK[kind]}`} />;
}
