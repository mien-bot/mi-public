"use client";

import { useMemo, useState } from "react";
import type { DropboxNode } from "@/lib/content";

export function filterDropboxNodes(nodes: DropboxNode[], query: string): DropboxNode[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return nodes;
  const matchFullPath = normalized.includes("/") || normalized.includes("\\");

  return nodes.flatMap((node) => {
    const searchable = matchFullPath ? node.relativePath : node.name;
    const selfMatches = searchable.toLocaleLowerCase().includes(normalized);

    if (!node.isDirectory) return selfMatches ? [node] : [];
    if (selfMatches) return [node];

    const children = filterDropboxNodes(node.children ?? [], query);
    return children.length > 0 ? [{ ...node, children }] : [];
  });
}

export function countDropboxNodes(nodes: DropboxNode[]): number {
  return nodes.reduce(
    (total, node) => total + 1 + (node.isDirectory ? countDropboxNodes(node.children ?? []) : 0),
    0,
  );
}

export function collectDropboxDirectoryPaths(nodes: DropboxNode[]): string[] {
  return nodes.flatMap((node) =>
    node.isDirectory
      ? [node.relativePath, ...collectDropboxDirectoryPaths(node.children ?? [])]
      : [],
  );
}

function fileHref(fileApiBase: string, slug: string, relativePath: string): string {
  return `${fileApiBase}/${slug}/${relativePath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

function DropboxTree({
  slug,
  nodes,
  expanded,
  searching,
  onToggle,
  depth = 0,
  fileApiBase,
}: {
  slug: string;
  nodes: DropboxNode[];
  expanded: ReadonlySet<string>;
  searching: boolean;
  onToggle: (relativePath: string) => void;
  depth?: number;
  fileApiBase: string;
}) {
  return (
    <ul className="flex flex-col gap-0.5" role={depth === 0 ? "tree" : "group"}>
      {nodes.map((node) => {
        if (!node.isDirectory) {
          return (
            <li key={node.relativePath} role="treeitem" aria-selected={false}>
              <a
                href={fileHref(fileApiBase, slug, node.relativePath)}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded px-2 py-1 text-sm hover:bg-muted hover:underline"
                style={{ paddingLeft: `${depth * 18 + 26}px` }}
                title={node.relativePath}
              >
                {node.name}
              </a>
            </li>
          );
        }

        const children = node.children ?? [];
        const isOpen = searching || expanded.has(node.relativePath);
        const hasChildren = children.length > 0;

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
              <DropboxTree
                slug={slug}
                nodes={children}
                expanded={expanded}
                searching={searching}
                onToggle={onToggle}
                depth={depth + 1}
                fileApiBase={fileApiBase}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function DropboxBrowser({
  slug,
  nodes,
  fileApiBase = "/api/dropbox-file",
}: {
  slug: string;
  nodes: DropboxNode[];
  fileApiBase?: string;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const normalizedQuery = query.trim();
  const filteredNodes = useMemo(() => filterDropboxNodes(nodes, query), [nodes, query]);
  const matchCount = useMemo(() => countDropboxNodes(filteredNodes), [filteredNodes]);
  const totalCount = useMemo(() => countDropboxNodes(nodes), [nodes]);

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
            Search Dropbox files and folders
          </span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, or use folder/file for a path…"
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
              onClick={() => setExpanded(new Set(collectDropboxDirectoryPaths(nodes)))}
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
        {normalizedQuery ? `${matchCount} item${matchCount === 1 ? "" : "s"} shown` : `${totalCount} items`}
      </p>

      {filteredNodes.length > 0 ? (
        <div className="rounded-lg border border-border p-2">
          <DropboxTree
            slug={slug}
            nodes={filteredNodes}
            expanded={expanded}
            searching={Boolean(normalizedQuery)}
            onToggle={toggle}
            fileApiBase={fileApiBase}
          />
        </div>
      ) : (
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          No Dropbox files or folders match “{normalizedQuery}”.
        </p>
      )}
    </div>
  );
}
