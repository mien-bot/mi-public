import { personalProposalEnvelopeSchema, type PersonalProposal } from "./schema";

const PERSONAL_PROPOSAL_BLOCK = /```mi-personal-proposals\s*([\s\S]*?)```/i;

export interface ParsedPersonalReply {
  reply: string;
  proposals: PersonalProposal[];
  proposalError: string | null;
}

export function parsePersonalReply(output: string): ParsedPersonalReply {
  const match = PERSONAL_PROPOSAL_BLOCK.exec(output);
  if (!match) return { reply: output.trim(), proposals: [], proposalError: null };

  const reply = output.replace(match[0], "").trim();
  try {
    const parsed = personalProposalEnvelopeSchema.parse(JSON.parse(match[1]));
    return { reply, proposals: parsed.proposals, proposalError: null };
  } catch {
    return {
      reply,
      proposals: [],
      proposalError: "The assistant proposed records in an invalid format, so nothing can be saved from that proposal.",
    };
  }
}
