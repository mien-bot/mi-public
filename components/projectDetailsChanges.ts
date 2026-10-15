import type { ProjectDetails } from "@/lib/schema";

export const DETAIL_LABELS: Record<keyof ProjectDetails, string> = {
  client_name: "Client", address: "Address", project_type: "Project type", scope: "Scope",
  fee: "Fee", fee_currency: "Currency", fee_notes: "Fee notes", contract_link_or_path: "Contract",
  client_contacts: "Client contacts", team: "Project team", phases: "Phases and agreements",
};
export function projectDetailsChanges(before: ProjectDetails, after: ProjectDetails) {
  return (Object.keys(DETAIL_LABELS) as (keyof ProjectDetails)[])
    .filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map(key => ({ key, label: DETAIL_LABELS[key], before: display(before[key]), after: display(after[key]) }));
}
function display(value: ProjectDetails[keyof ProjectDetails]): string {
  if (value === null || value === "" || (Array.isArray(value) && !value.length)) return "Not recorded";
  if (Array.isArray(value)) return value.map(item => Object.entries(item)
    .filter(([key, entry]) => key !== "id" && entry !== "" && entry !== null)
    .map(([key, entry]) => `${key.replaceAll("_", " ")}: ${entry}`).join(" · ")).join("\n\n");
  return String(value);
}
