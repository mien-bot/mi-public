import type { PersonalDatabase, PersonalRecordKind, PersonalRecordStatus } from "./schema";

export type PersonalGraphNodeKind = PersonalRecordKind | "root" | "schedule" | "chat" | "tag";

export interface PersonalGraphNode {
  id: string;
  label: string;
  kind: PersonalGraphNodeKind;
  detail: string;
  weight: number;
}

export interface PersonalGraphLink {
  source: string;
  target: string;
}

export interface PersonalAnalytics {
  totalRecords: number;
  scheduledPlans: number;
  sharedPlans: number;
  conversations: number;
  chatMessages: number;
  kindDistribution: Record<PersonalRecordKind, number>;
  statusDistribution: Record<PersonalRecordStatus, number>;
  shareDistribution: Record<"local" | "pending" | "shared" | "needs-review", number>;
  topTags: Array<{ tag: string; count: number }>;
  monthlyActivity: Array<{ month: string; count: number }>;
  graph: {
    nodes: PersonalGraphNode[];
    links: PersonalGraphLink[];
  };
}
export function buildPersonalAnalytics(database: PersonalDatabase, now = new Date()): PersonalAnalytics {
  const kindDistribution = { journal: 0, thought: 0, task: 0, plan: 0 };
  const statusDistribution = { inbox: 0, active: 0, done: 0, archived: 0 };
  const shareDistribution = { local: 0, pending: 0, shared: 0, "needs-review": 0 };
  const tags = new Map<string, number>();
  for (const record of database.records) {
    kindDistribution[record.kind] += 1;
    statusDistribution[record.status] += 1;
    shareDistribution[record.share.status] += 1;
    for (const tag of record.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
  }
  const monthlyActivity = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    return {
      month,
      count: database.records.filter((record) => record.createdAt.startsWith(month)).length,
    };
  });
  const topTags = [...tags]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, 20);
  const graphNodes: PersonalGraphNode[] = [{
    id: "personal-root",
    label: "Personal Mi",
    kind: "root",
    detail: `${database.records.length} records · ${database.conversations.length} chats`,
    weight: Math.max(3, database.records.length + database.conversations.length),
  }];
  const graphLinks: PersonalGraphLink[] = [];
  const recordNodeIds = new Map<number, string>();

  database.records.forEach((record, index) => {
    const id = `record:${index}:${record.id}`;
    recordNodeIds.set(index, id);
    graphNodes.push({
      id,
      label: record.title,
      kind: record.kind,
      detail: `${record.kind} · ${record.status}`,
      weight: Math.max(1, record.tags.length + (record.body ? 1 : 0)),
    });
    graphLinks.push({ source: "personal-root", target: id });
    if (record.schedule) {
      const scheduleId = `schedule:${index}:${record.id}`;
      graphNodes.push({
        id: scheduleId,
        label: record.schedule.name,
        kind: "schedule",
        detail: `${record.schedule.date} · ${record.schedule.type}`,
        weight: 2,
      });
      graphLinks.push({ source: id, target: scheduleId });
    }
  });

  database.conversations.forEach((conversation, index) => {
    const id = `chat:${index}:${conversation.id}`;
    graphNodes.push({
      id,
      label: conversation.title,
      kind: "chat",
      detail: `${conversation.messages.length} message${conversation.messages.length === 1 ? "" : "s"}`,
      weight: Math.max(1, conversation.messages.length),
    });
    graphLinks.push({ source: "personal-root", target: id });
  });

  const topTagNames = new Set(topTags.map(({ tag }) => tag));
  topTags.forEach(({ tag, count }, tagIndex) => {
    const id = `tag:${tagIndex}:${tag}`;
    graphNodes.push({ id, label: `#${tag}`, kind: "tag", detail: `${count} record${count === 1 ? "" : "s"}`, weight: count });
    database.records.forEach((record, recordIndex) => {
      if (record.tags.includes(tag) && topTagNames.has(tag)) {
        graphLinks.push({ source: recordNodeIds.get(recordIndex)!, target: id });
      }
    });
  });

  return {
    totalRecords: database.records.length,
    scheduledPlans: database.records.filter((record) => Boolean(record.schedule)).length,
    sharedPlans: shareDistribution.shared,
    conversations: database.conversations.length,
    chatMessages: database.conversations.reduce((sum, conversation) => sum + conversation.messages.length, 0),
    kindDistribution,
    statusDistribution,
    shareDistribution,
    topTags: topTags.slice(0, 10),
    monthlyActivity,
    graph: { nodes: graphNodes, links: graphLinks },
  };
}
