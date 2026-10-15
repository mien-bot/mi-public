export type ProjectDraftEngine = "codex" | "claude";
export type ProjectDraftPurpose = "planning" | "meeting";
export const PROJECT_DRAFT_READ_ONLY = true;

export function projectDraftEnvironment(
  engine: ProjectDraftEngine,
  restrictedEnvironment: Readonly<Record<string, string | undefined>>,
  claudeSubscriptionToken: string | undefined,
): NodeJS.ProcessEnv {
  const environment: Record<string, string | undefined> = {
    ...restrictedEnvironment,
  };
  delete environment.CLAUDE_CODE_OAUTH_TOKEN;
  delete environment.ANTHROPIC_API_KEY;
  if (engine === "claude" && claudeSubscriptionToken?.trim()) {
    environment.CLAUDE_CODE_OAUTH_TOKEN = claudeSubscriptionToken.trim();
  }
  // Node's spawn env accepts this string dictionary. The assertion avoids
  // Next's global type augmentation making NODE_ENV mandatory in test inputs.
  return environment as NodeJS.ProcessEnv;
}

export function projectDraftPrompt(
  purpose: ProjectDraftPurpose,
  projectName: string,
  input: unknown,
): string {
  const safety = "You are in a read-only environment. Do not use tools, write files, contact external systems, or modify Notion/Dropbox.";
  if (purpose === "planning") {
    return `You are drafting a project plan for human review. ${safety} The planning input contains the user's current brief plus Mi's existing project details, phases, and milestones. Treat existing records as evidence: preserve confirmed dates, avoid duplicate milestones, flag conflicts in the summary, and make new recommendations fit within confirmed phase boundaries. Return JSON only with shape {"summary":"...","timeline":[{"name":"...","date":"YYYY-MM-DD","type":"Deadline|Midterm Deadline|Kick-off|Meeting|Client Meeting|Internal Meeting|Work Session","rationale":"..."}]}. Only use "Meeting"/"Client Meeting"/"Internal Meeting"/"Work Session" when the planning input actually implies a meeting or working session, not for every item. Do not invent dates when the input does not support them; return fewer items instead.\n\nProject: ${projectName}\nPlanning input:\n${JSON.stringify(input, null, 2)}`;
  }
  return `You are drafting a meeting summary for human review. ${safety} Return JSON only with shape {"summary":"...","decisions":["..."],"action_items":[{"description":"...","owner":"","due_date":"YYYY-MM-DD or empty"}],"open_questions":["..."]}. Preserve uncertainty; do not invent owners or due dates.\n\nProject: ${projectName}\nMeeting input:\n${JSON.stringify(input, null, 2)}`;
}
