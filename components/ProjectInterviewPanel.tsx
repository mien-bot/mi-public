"use client";

import { useCallback, useEffect, useState } from "react";
import { ChatThread } from "@/components/ChatThread";
import type { AgentEngine, ChatMessage } from "@/components/chatTypes";
import {
  computeInterviewSteps,
  parseInterviewNavigation,
  type InterviewStepId,
  type InterviewStepVerdict,
} from "@/components/projectInterviewSteps";
import { parseProjectCopilotReply, type ProjectCopilotProposal } from "@/lib/projectCopilot";
import type { ProjectDetails, ProjectMeta, Schedule } from "@/lib/schema";

type ContextState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      details: ProjectDetails;
      meta: ProjectMeta;
      schedule: Schedule;
      steps: InterviewStepVerdict[];
    };

/**
 * Short "fields already known" text embedded in the model's step directive
 * (see lib/agentContext.ts's interviewStepInstructions) so it doesn't
 * re-propose values already on file. For the schedule step this reports the
 * exact matched-milestone list computed by computeInterviewSteps -- the
 * model is told what Mi *found*, never told to treat it as confirmed-correct.
 */
function describeAlreadyKnown(
  stepId: InterviewStepId,
  details: ProjectDetails,
  meta: ProjectMeta,
  stepVerdict: InterviewStepVerdict | null,
): string {
  switch (stepId) {
    case "client-contacts": {
      const parts: string[] = [];
      if (details.client_name) parts.push(`client_name="${details.client_name}"`);
      if (details.client_contacts.length) parts.push(`${details.client_contacts.length} contact(s) on file`);
      return parts.join(", ") || "none yet";
    }
    case "address-scope": {
      const parts: string[] = [];
      if (details.address) parts.push(`address="${details.address}"`);
      if (details.scope) parts.push(`scope="${details.scope}"`);
      if (details.project_type) parts.push(`project_type="${details.project_type}"`);
      return parts.join(", ") || "none yet";
    }
    case "building-meta": {
      const parts: string[] = [];
      if (meta.building_type) parts.push(`building_type="${meta.building_type}"`);
      if (meta.occupancy_group.length) parts.push(`occupancy_group=[${meta.occupancy_group.join(", ")}]`);
      return parts.join(", ") || "none yet";
    }
    case "team-fee": {
      const parts: string[] = [];
      if (details.team.length) parts.push(`${details.team.length} team member(s) on file`);
      if (details.fee !== null) parts.push(`fee=${details.fee} ${details.fee_currency}`);
      return parts.join(", ") || "none yet";
    }
    case "schedule": {
      const matches = stepVerdict?.matchedMilestones ?? [];
      if (!matches.length) return "none yet";
      return matches.map((match) => `${match.topicLabel} ("${match.milestoneName}")`).join(", ");
    }
    case "constraints-deliverables":
    case "review":
      return "none yet";
  }
}

/**
 * Guided, step-by-step "interview" mode for the project AI chat -- modeled
 * on app/onboarding/page.tsx's STEPS/step/goNext/goBack wizard idiom, but
 * walking through project fields and schedule milestones instead of
 * first-run setup. Every resulting suggestion routes through the exact same
 * confirm-gated pipeline as free-form chat: parseProjectCopilotReply here,
 * ChatThread + ProjectCopilotProposalList for review/confirm, and ultimately
 * app/api/projects/[slug]/copilot/route.ts for the write itself. This
 * component adds no new write path of its own.
 */
export function ProjectInterviewPanel({
  projectSlug,
  engine,
  model,
  notionLinked,
}: {
  projectSlug: string;
  engine: AgentEngine;
  model: string | null;
  notionLinked: boolean;
}) {
  const [contextState, setContextState] = useState<ContextState>({ status: "loading" });
  const [stepIndex, setStepIndex] = useState(0);
  const [stepMessages, setStepMessages] = useState<Partial<Record<InterviewStepId, ChatMessage[]>>>({});
  const [stepSessionIds, setStepSessionIds] = useState<Partial<Record<InterviewStepId, string | null>>>({});
  const [input, setInput] = useState("");
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [allProposals, setAllProposals] = useState<ProjectCopilotProposal[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  // ChatWidget.tsx always renders this component with a
  // `key={makeThreadKey(engine, model, projectSlug, "interview")}` -- any
  // change to project/engine/model forces a full remount (fresh useState
  // defaults), so this effect never needs to manually reset state for a
  // projectSlug change; it only ever runs once, on mount, to kick off the
  // fetch below.
  useEffect(() => {
    let cancelled = false;

    fetch(`/api/projects/${encodeURIComponent(projectSlug)}/interview-context`)
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error || "Could not load this project's current answers.");
        }
        return response.json() as Promise<{ details: ProjectDetails; meta: ProjectMeta; schedule: Schedule }>;
      })
      .then(({ details, meta, schedule }) => {
        if (cancelled) return;
        const steps = computeInterviewSteps(details, meta, schedule);
        const firstNeededIndex = steps.findIndex((step) => step.needed);
        setContextState({ status: "ready", details, meta, schedule, steps });
        setStepIndex(firstNeededIndex === -1 ? steps.length - 1 : firstNeededIndex);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setContextState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [projectSlug]);

  const steps = contextState.status === "ready" ? contextState.steps : [];
  const currentStep = steps[stepIndex] ?? null;

  /**
   * The review step's single message is a pure function of allProposals --
   * synthesized directly during render (not stored via a setState-in-effect)
   * so it's always in sync with whatever has been proposed so far.
   * ChatThread and ProjectCopilotProposalList need zero changes to show it.
   */
  const reviewMessages: ChatMessage[] = [
    {
      id: "review-summary",
      role: "assistant",
      text: allProposals.length
        ? "Here's everything proposed across every step so far. Nothing is saved until you review and confirm each card below."
        : "Nothing has been proposed yet. Use Back to revisit a step, or close this panel.",
      proposals: allProposals,
      proposalError: null,
      createdAt: 0,
    },
  ];

  const goBack = useCallback(() => {
    setNotice(null);
    setStepIndex((current) => Math.max(current - 1, 0));
  }, []);

  // Continue/Back are never blocked on confirming a proposal -- an
  // unconfirmed proposal only produces this small non-blocking notice and is
  // carried into the Review step's synthesized message above, never lost.
  const goNext = useCallback(() => {
    if (!currentStep) return;
    const unconfirmedCount = (stepMessages[currentStep.id] ?? []).reduce(
      (sum, message) => sum + (message.proposals?.length ?? 0),
      0,
    );
    if (unconfirmedCount > 0) {
      setNotice(`Carried ${unconfirmedCount} proposal(s) from "${currentStep.label}" into Review.`);
    } else {
      setNotice(null);
    }
    setStepIndex((current) => Math.min(current + 1, steps.length - 1));
  }, [currentStep, stepMessages, steps.length]);

  const skip = useCallback(() => {
    setNotice(null);
    setStepIndex((current) => Math.min(current + 1, steps.length - 1));
  }, [steps.length]);

  const send = useCallback(() => {
    const api = window.electronAPI;
    const prompt = input.trim();
    if (!api || !currentStep || contextState.status !== "ready" || !prompt) return;

    // "next"/"skip" typed into the box is navigation, not a question for the agent. Handling it
    // here makes it instant and keeps the model from claiming it moved the step itself.
    const navigation = parseInterviewNavigation(prompt);
    if (navigation) {
      setInput("");
      if (navigation === "next") goNext();
      else goBack();
      return;
    }

    const stepId = currentStep.id;
    const requestId = crypto.randomUUID();
    const sessionIdAtSend = stepSessionIds[stepId] ?? null;
    const alreadyKnownSummary = describeAlreadyKnown(stepId, contextState.details, contextState.meta, currentStep);

    setInput("");
    setNotice(null);

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", text: prompt, createdAt: Date.now() };
    const pendingMessage: ChatMessage = { id: requestId, role: "assistant", text: "", pending: true, createdAt: Date.now() };

    setStepMessages((prev) => ({
      ...prev,
      [stepId]: [...(prev[stepId] ?? []), userMessage, pendingMessage],
    }));
    setActiveRequestId(requestId);

    api.agent
      .send({
        requestId,
        engine,
        cwd: `projects/${projectSlug}`,
        prompt,
        sessionId: sessionIdAtSend,
        model: model || null,
        interviewStepId: stepId,
        interviewAlreadyKnownSummary: alreadyKnownSummary,
      })
      .then((result) => {
        setActiveRequestId((current) => (current === requestId ? null : current));
        setStepSessionIds((prev) => ({ ...prev, [stepId]: result.sessionId ?? prev[stepId] ?? null }));
        const parsedReply = !result.isError
          ? parseProjectCopilotReply(result.fullOutput)
          : { text: result.fullOutput, proposals: [] as ProjectCopilotProposal[], proposalError: null as string | null };

        setStepMessages((prev) => ({
          ...prev,
          [stepId]: (prev[stepId] ?? []).map((message) =>
            message.id === requestId
              ? {
                  ...message,
                  role: result.isError ? "error" : "assistant",
                  text: parsedReply.text || message.text,
                  proposals: parsedReply.proposals,
                  proposalError: parsedReply.proposalError,
                  pending: false,
                }
              : message,
          ),
        }));

        if (parsedReply.proposals.length) {
          setAllProposals((prev) => {
            const known = new Set(prev.map((proposal) => proposal.id));
            const additions = parsedReply.proposals.filter((proposal) => !known.has(proposal.id));
            return additions.length ? [...prev, ...additions] : prev;
          });
        }
      })
      .catch((err: unknown) => {
        setActiveRequestId((current) => (current === requestId ? null : current));
        const message = err instanceof Error ? err.message : String(err);
        setStepMessages((prev) => ({
          ...prev,
          [stepId]: (prev[stepId] ?? []).map((entry) =>
            entry.id === requestId ? { ...entry, role: "error", text: message, pending: false } : entry,
          ),
        }));
      });
  }, [input, currentStep, contextState, stepSessionIds, engine, model, projectSlug, goNext, goBack]);

  const cancel = useCallback(() => {
    const api = window.electronAPI;
    if (!api || !activeRequestId) return;
    api.agent.cancel(activeRequestId);
  }, [activeRequestId]);


  if (contextState.status === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">
        Loading this project&apos;s current answers…
      </div>
    );
  }

  if (contextState.status === "error") {
    return (
      <div role="alert" className="p-4 text-sm text-status-danger-foreground">
        {contextState.message}
      </div>
    );
  }

  if (!currentStep) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">
        Nothing left to guide here.
      </div>
    );
  }

  const api = window.electronAPI;
  const isReviewStep = currentStep.id === "review";
  const messages = isReviewStep ? reviewMessages : stepMessages[currentStep.id] ?? [];
  const isLastStep = stepIndex === steps.length - 1;

  return (
    <div className="flex min-h-64 flex-1 shrink-0 flex-col overflow-y-auto">
      <div className="shrink-0 border-b border-border p-3">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Guided setup — step {stepIndex + 1} of {steps.length}
        </p>
        <h3 className="mt-1 text-sm font-medium">{currentStep.label}</h3>
        {/* Kept with the step heading rather than pinned to the bottom of the panel: these move
            between steps, so sitting under the conversation made them read as actions on the
            message you just typed. */}
        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={stepIndex === 0}
            onClick={goBack}
            className="rounded-md border border-border px-2.5 py-1 text-xs disabled:opacity-40"
          >
            Back
          </button>
          <div className="flex gap-2">
            {!isReviewStep && (
              <button
                type="button"
                onClick={skip}
                className="rounded-md border border-border px-2.5 py-1 text-xs"
              >
                Skip
              </button>
            )}
            {!isLastStep && (
              <button
                type="button"
                onClick={goNext}
                className="rounded-md bg-foreground px-3 py-1 text-xs text-background"
              >
                Continue
              </button>
            )}
          </div>
        </div>
        {currentStep.skipReason && (
          <p className="mt-1 text-xs text-muted-foreground">{currentStep.skipReason}</p>
        )}
        {currentStep.matchedMilestones && currentStep.matchedMilestones.length > 0 && (
          <div className="mt-2 rounded-md border border-border bg-background p-2 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Mi found these existing milestones:</p>
            <ul className="mt-1 space-y-0.5">
              {currentStep.matchedMilestones.map((match, index) => (
                <li key={`${match.topic}-${index}`}>
                  {match.topicLabel}: &quot;{match.milestoneName}&quot;
                </li>
              ))}
            </ul>
          </div>
        )}
        {notice && <p className="mt-2 text-xs text-muted-foreground">{notice}</p>}
      </div>

      {!api ? (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">
          Guided setup is only available in the desktop app.
        </div>
      ) : (
        <ChatThread
          messages={messages}
          projectSlug={projectSlug}
          notionLinked={notionLinked}
          currentValues={
            contextState.status === "ready"
              ? {
                  details: contextState.details,
                  meta: {
                    building_type: contextState.meta.building_type,
                    occupancy_group: contextState.meta.occupancy_group,
                  },
                }
              : undefined
          }
        />
      )}

      {!isReviewStep && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
          className="flex shrink-0 flex-col gap-2 border-t border-border p-3"
        >
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder="Answer this step…"
              rows={1}
              disabled={!api}
              className="min-w-0 flex-1 resize-none rounded-md border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-accent disabled:opacity-50"
            />
            {activeRequestId ? (
              <button
                type="button"
                onClick={cancel}
                className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-accent hover:text-foreground"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!api || !input.trim()}
                className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground transition-opacity disabled:opacity-50"
              >
                Send
              </button>
            )}
          </div>
        </form>
      )}

    </div>
  );
}
