interface TerminalBufferLineLike {
  isWrapped: boolean;
  translateToString(trimRight?: boolean): string;
}

interface TerminalBufferLike {
  length: number;
  getLine(index: number): TerminalBufferLineLike | undefined;
}

const FENCED_PROPOSAL_BLOCK = /```mi-proposals\s*[\s\S]*?```/gi;

/** Rebuilds logical lines after xterm has hard-wrapped long JSON across screen rows. */
export function terminalBufferText(buffer: TerminalBufferLike): string {
  let text = "";
  for (let index = 0; index < buffer.length; index++) {
    const line = buffer.getLine(index);
    if (!line) continue;
    if (text && !line.isWrapped) text += "\n";
    text += line.translateToString(true);
  }
  return text;
}

function balancedJsonObjects(text: string): string[] {
  const objects: string[] = [];
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== "{") continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < text.length; index++) {
      const character = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === "{") depth++;
      else if (character === "}") {
        depth--;
        if (depth === 0) {
          objects.push(text.slice(start, index + 1));
          start = index;
          break;
        }
      }
    }
  }
  return objects;
}

/**
 * Codex and Claude may render Markdown fences instead of leaving the literal backticks in the
 * xterm buffer. Prefer a literal block, then fall back to the last complete proposal envelope.
 * The server still performs the authoritative schema validation before saving a draft.
 */
export function latestTerminalProposalBlock(text: string): string | null {
  const fenced = [...text.matchAll(FENCED_PROPOSAL_BLOCK)];
  if (fenced.length > 0) return fenced.at(-1)?.[0] ?? null;

  const candidates = balancedJsonObjects(text).filter((candidate) => {
    try {
      const value: unknown = JSON.parse(candidate);
      return Boolean(
        value
        && typeof value === "object"
        && "version" in value
        && value.version === 1
        && "proposals" in value
        && Array.isArray(value.proposals),
      );
    } catch {
      return false;
    }
  });
  const latest = candidates.at(-1);
  return latest ? `\`\`\`mi-proposals\n${latest}\n\`\`\`` : null;
}

export function projectSlugFromTerminalCwd(cwd: string): string | null {
  const match = /^projects\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(cwd.replaceAll("\\", "/"));
  return match?.[1] ?? null;
}
