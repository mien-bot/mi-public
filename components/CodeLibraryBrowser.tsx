"use client";

import { useMemo, useState } from "react";
import type { LocalCodeLibraryNode } from "@/lib/content/localCodeLibrary";

export function filterCodeLibraryNodes(
  nodes: LocalCodeLibraryNode[],
  query: string,
): LocalCodeLibraryNode[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return nodes;
  const matchFullPath = normalized.includes("/") || normalized.includes("\\");

  return nodes.flatMap((node): LocalCodeLibraryNode[] => {
    const searchable = matchFullPath ? node.relativePath : node.name;
    const selfMatches = searchable.toLocaleLowerCase().includes(normalized);

    if (node.kind === "file") return selfMatches ? [node] : [];
    if (selfMatches) return [node];

    const children = filterCodeLibraryNodes(node.children, query);
    return children.length > 0 ? [{ ...node, children }] : [];
  });
}

export function countCodeLibraryDocuments(nodes: LocalCodeLibraryNode[]): number {
  return nodes.reduce(
    (total, node) =>
      total + (node.kind === "file" ? 1 : countCodeLibraryDocuments(node.children)),
    0,
  );
}

export function collectCodeLibraryDirectoryPaths(nodes: LocalCodeLibraryNode[]): string[] {
  return nodes.flatMap((node) =>
    node.kind === "directory"
      ? [node.relativePath, ...collectCodeLibraryDirectoryPaths(node.children)]
      : [],
  );
}

function sourceDocumentHref(relativePath: string): string {
  return `/codes/source/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function CodeLibraryTree({
  nodes,
  expanded,
  searching,
  onToggle,
  depth = 0,
}: {
  nodes: LocalCodeLibraryNode[];
  expanded: ReadonlySet<string>;
  searching: boolean;
  onToggle: (relativePath: string) => void;
  depth?: number;
}) {
  return (
    <ul className="flex flex-col gap-0.5" role={depth === 0 ? "tree" : "group"}>
      {nodes.map((node) => {
        if (node.kind === "file") {
          return (
            <li key={node.relativePath} role="treeitem" aria-selected={false}>
              <a
                href={sourceDocumentHref(node.relativePath)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-3 rounded px-2 py-1 text-sm hover:bg-muted hover:underline"
                style={{ paddingLeft: `${depth * 18 + 26}px` }}
                title={node.relativePath}
              >
                <span className="min-w-0 truncate">{node.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {node.extension.slice(1).toUpperCase()} · {formatBytes(node.sizeBytes)}
                </span>
              </a>
            </li>
          );
        }

        const isOpen = searching || expanded.has(node.relativePath);
        const hasChildren = node.children.length > 0;

        return (
          <li
            key={node.relativePath}
            role="treeitem"
            aria-selected={false}
            aria-expanded={hasChildren ? isOpen : undefined}
          >
            <button
              type="button"
              onClick={() => hasChildren && onToggle(node.relativePath)}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-default"
              style={{ paddingLeft: `${depth * 18 + 8}px` }}
              disabled={!hasChildren || searching}
              title={node.relativePath}
            >
              <span className="w-3 text-center text-[10px]" aria-hidden="true">
                {hasChildren ? (isOpen ? "▼" : "▶") : ""}
              </span>
              <span>{node.name}/</span>
            </button>
            {hasChildren && isOpen && (
              <CodeLibraryTree
                nodes={node.children}
                expanded={expanded}
                searching={searching}
                onToggle={onToggle}
                depth={depth + 1}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function CodeLibraryBrowser({ nodes }: { nodes: LocalCodeLibraryNode[] }) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const normalizedQuery = query.trim();
  const filteredNodes = useMemo(() => filterCodeLibraryNodes(nodes, query), [nodes, query]);
  const visibleDocumentCount = useMemo(
    () => countCodeLibraryDocuments(filteredNodes),
    [filteredNodes],
  );
  const totalDocumentCount = useMemo(() => countCodeLibraryDocuments(nodes), [nodes]);

  const toggle = (relativePath: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(relativePath)) next.delete(relativePath);
      else next.add(relativePath);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-64 flex-1">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">
            Search local code documents
          </span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by filename, or use folder/file for a path…"
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-accent"
          />
        </label>
        {normalizedQuery ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:border-accent hover:text-foreground"
          >
            Clear search
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setExpanded(new Set(collectCodeLibraryDirectoryPaths(nodes)))}
              className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:border-accent hover:text-foreground"
            >
              Expand all
            </button>
            <button
              type="button"
              onClick={() => setExpanded(new Set())}
              className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:border-accent hover:text-foreground"
            >
              Collapse all
            </button>
          </>
        )}
      </div>

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {normalizedQuery
          ? `${visibleDocumentCount} matching document${visibleDocumentCount === 1 ? "" : "s"}`
          : `${totalDocumentCount} documents`}
      </p>

      {filteredNodes.length > 0 ? (
        <div className="rounded-lg border border-border p-2">
          <CodeLibraryTree
            nodes={filteredNodes}
            expanded={expanded}
            searching={Boolean(normalizedQuery)}
            onToggle={toggle}
          />
        </div>
      ) : (
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          {normalizedQuery
            ? `No local code documents match “${normalizedQuery}”.`
            : "No supported local code documents were found."}
        </p>
      )}
    </div>
  );
}
