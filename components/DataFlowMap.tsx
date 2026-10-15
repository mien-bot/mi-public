"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

export type DataFlowTone = "accent" | "success" | "warning" | "danger" | "neutral";

export interface DataFlowNode {
  id: string;
  label: string;
  value: number;
  detail?: string;
  href?: string;
  tone?: DataFlowTone;
}

export interface DataFlowLink {
  source: string;
  target: string;
  strength?: number;
}

export interface PositionedDataFlowNode extends DataFlowNode {
  x: number;
  y: number;
  radius: number;
}

type DragState =
  | { kind: "node"; id: string; pointerId: number; moved: boolean }
  | { kind: "pan"; pointerId: number; x: number; y: number; panX: number; panY: number }
  | null;

type ColorMode = "category" | "blueprint" | "monochrome";

const WIDTH = 900;
const HEIGHT = 560;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;

const TONE_COLOR: Record<DataFlowTone, string> = {
  accent: "var(--accent)",
  success: "var(--status-success-foreground)",
  warning: "var(--status-warning-foreground)",
  danger: "var(--status-danger-foreground)",
  neutral: "var(--muted-foreground)",
};

export function layoutDataFlowNodes(nodes: DataFlowNode[]): PositionedDataFlowNode[] {
  const max = Math.max(1, ...nodes.map((node) => node.value));
  const count = Math.max(1, nodes.length);
  return nodes.map((node, index) => {
    const angle = (-Math.PI / 2) + ((Math.PI * 2 * index) / count);
    const alternateRing = count > 8 && index % 2 === 1 ? 0.78 : 1;
    return {
      ...node,
      x: CENTER_X + Math.cos(angle) * 325 * alternateRing,
      y: CENTER_Y + Math.sin(angle) * 205 * alternateRing,
      radius: 18 + Math.sqrt(node.value / max) * 23,
    };
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function shortLabel(label: string): string {
  return label.length > 20 ? `${label.slice(0, 19)}…` : label;
}

/**
 * The per-bubble ambient float, as CSS custom properties for the `neon-drift` keyframe in
 * app/globals.css. The animation itself only ever advances at the Cinematic motion level.
 *
 * Everything is derived from the node's index rather than from `Math.random()`, for two
 * reasons: a random value would differ between the server and client renders and blow up
 * hydration, and it would change on every re-render, restarting the animation each time
 * the graph's controls move. The golden-ratio step spreads the phases so no two
 * neighbouring bubbles bob in lockstep, and the negative delay starts each one part-way
 * through its cycle, so the field is already dispersed on the first frame instead of
 * pulsing in unison.
 *
 * Amplitude tops out at 8px against a smallest radius of 18px: enough to read as alive,
 * far too little to make you doubt which bubble you are pointing at.
 */
function driftStyle(index: number): React.CSSProperties {
  const phase = (index * 0.618033988749895) % 1;
  const amplitude = 4 + ((index * 3) % 5);
  return {
    "--drift-x": `${index % 2 === 0 ? amplitude : -amplitude}px`,
    "--drift-y": `${(amplitude * 0.75).toFixed(2)}px`,
    "--drift-duration": `${7 + (index % 5)}s`,
    "--drift-delay": `${-(phase * 6).toFixed(2)}s`,
  } as React.CSSProperties;
}

function colorFor(node: DataFlowNode, mode: ColorMode): string {
  if (mode === "blueprint") return "var(--accent)";
  if (mode === "monochrome") return "var(--foreground)";
  return TONE_COLOR[node.tone ?? "accent"];
}

export function DataFlowMap({
  title,
  description,
  centerLabel,
  centerValue,
  centerHref,
  nodes,
  links = [],
  defaultOpen = false,
}: {
  title: string;
  description: string;
  centerLabel: string;
  centerValue: number;
  centerHref?: string;
  nodes: DataFlowNode[];
  links?: DataFlowLink[];
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState>(null);
  const [positioned, setPositioned] = useState(() => layoutDataFlowNodes(nodes));
  const [selectedId, setSelectedId] = useState(nodes[0]?.id ?? "");
  const [nodeScale, setNodeScale] = useState(1);
  const [linkWidth, setLinkWidth] = useState(1.4);
  const [flowSpeed, setFlowSpeed] = useState(1);
  const [colorMode, setColorMode] = useState<ColorMode>("category");
  const [running, setRunning] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const byId = useMemo(() => new Map(positioned.map((node) => [node.id, node])), [positioned]);
  const selected = byId.get(selectedId) ?? positioned[0];
  const allLinks = useMemo(() => [
    ...nodes.map((node) => ({ source: "__center", target: node.id, strength: 1 })),
    ...links,
  ], [links, nodes]);

  function svgPoint(clientX: number, clientY: number): { x: number; y: number } {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return { x: clientX, y: clientY };
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }

  function worldPoint(clientX: number, clientY: number): { x: number; y: number } {
    const point = svgPoint(clientX, clientY);
    return { x: (point.x - pan.x) / zoom, y: (point.y - pan.y) / zoom };
  }

  function startNodeDrag(event: ReactPointerEvent<SVGGElement>, id: string) {
    event.stopPropagation();
    svgRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = { kind: "node", id, pointerId: event.pointerId, moved: false };
    setSelectedId(id);
  }

  function startPan(event: ReactPointerEvent<SVGRectElement>) {
    const point = svgPoint(event.clientX, event.clientY);
    svgRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = { kind: "pan", pointerId: event.pointerId, x: point.x, y: point.y, panX: pan.x, panY: pan.y };
  }

  function movePointer(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.kind === "pan") {
      const point = svgPoint(event.clientX, event.clientY);
      setPan({ x: drag.panX + point.x - drag.x, y: drag.panY + point.y - drag.y });
      return;
    }
    const point = worldPoint(event.clientX, event.clientY);
    drag.moved = true;
    setPositioned((current) => current.map((node) => node.id === drag.id
      ? { ...node, x: clamp(point.x, 30, WIDTH - 30), y: clamp(point.y, 30, HEIGHT - 30) }
      : node));
  }

  function endPointer(event: ReactPointerEvent<SVGSVGElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
  }

  function zoomGraph(event: ReactWheelEvent<SVGSVGElement>) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    event.stopPropagation();
    const point = svgPoint(event.clientX, event.clientY);
    const nextZoom = clamp(zoom * Math.exp(-event.deltaY * 0.001), 0.5, 3.2);
    const worldX = (point.x - pan.x) / zoom;
    const worldY = (point.y - pan.y) / zoom;
    setZoom(nextZoom);
    setPan({ x: point.x - worldX * nextZoom, y: point.y - worldY * nextZoom });
  }

  function resetView() {
    setPositioned(layoutDataFlowNodes(nodes));
    setSelectedId(nodes[0]?.id ?? "");
    setPan({ x: 0, y: 0 });
    setZoom(1);
  }

  return (
    <details open={defaultOpen} className="group rounded-xl border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 [&::-webkit-details-marker]:hidden">
        <div>
          <h2 className="font-medium">{title}</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
        </div>
        <span className="shrink-0 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground group-open:border-accent group-open:text-foreground">
          {nodes.length} nodes · {allLinks.length} connections
        </span>
      </summary>
      <div className="border-t border-border p-4 sm:p-5">
        <div className="grid gap-3 rounded-lg border border-border bg-background/70 p-3 sm:grid-cols-2 xl:grid-cols-5">
          <label className="text-xs text-muted-foreground">Color system
            <select value={colorMode} onChange={(event) => setColorMode(event.target.value as ColorMode)} className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-foreground">
              <option value="category">By data type</option>
              <option value="blueprint">Blueprint</option>
              <option value="monochrome">Monochrome</option>
            </select>
          </label>
          <label className="text-xs text-muted-foreground">Node size · {nodeScale.toFixed(1)}×
            <input type="range" min="0.65" max="1.8" step="0.05" value={nodeScale} onChange={(event) => setNodeScale(Number(event.target.value))} className="mt-2 w-full accent-accent" />
          </label>
          <label className="text-xs text-muted-foreground">Connection size · {linkWidth.toFixed(1)} px
            <input type="range" min="0.5" max="4" step="0.1" value={linkWidth} onChange={(event) => setLinkWidth(Number(event.target.value))} className="mt-2 w-full accent-accent" />
          </label>
          <label className="text-xs text-muted-foreground">Flow speed · {flowSpeed.toFixed(1)}×
            <input type="range" min="0.3" max="2.5" step="0.1" value={flowSpeed} onChange={(event) => setFlowSpeed(Number(event.target.value))} className="mt-2 w-full accent-accent" />
          </label>
          <div className="flex items-end gap-2">
            <button type="button" onClick={() => setRunning((value) => !value)} className="flex-1 rounded-md border border-border px-2 py-1.5 text-xs hover:border-accent">{running ? "Pause motion" : "Resume motion"}</button>
            <button type="button" onClick={resetView} className="rounded-md border border-border px-2 py-1.5 text-xs hover:border-accent">Reset</button>
          </div>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">Drag nodes to arrange · drag empty space to pan · Ctrl/Cmd + scroll to zoom · regular scrolling moves the page · double-click a node to open its record.</p>
        <svg
          ref={svgRef}
          data-local-wheel-zoom
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`${title}. Interactive graph with ${nodes.length} nodes and ${allLinks.length} connections.`}
          onPointerMove={movePointer}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onWheel={zoomGraph}
          className="knowledge-graph-grid mt-3 h-[min(42rem,68vh)] min-h-[30rem] w-full touch-none overflow-hidden rounded-lg border border-border bg-background"
        >
          <rect width={WIDTH} height={HEIGHT} fill="transparent" onPointerDown={startPan} />
          <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
            {allLinks.map((link, index) => {
              const source = link.source === "__center" ? { x: CENTER_X, y: CENTER_Y } : byId.get(link.source);
              const target = link.target === "__center" ? { x: CENTER_X, y: CENTER_Y } : byId.get(link.target);
              if (!source || !target) return null;
              return <line
                key={`${link.source}:${link.target}:${index}`}
                className="data-flow-edge"
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke="var(--accent)"
                strokeWidth={linkWidth * (link.strength ?? 1)}
                strokeOpacity={link.source === "__center" ? 0.24 : 0.5}
                style={{ animationDuration: `${3 / flowSpeed}s`, animationPlayState: running ? "running" : "paused" }}
              />;
            })}

            <g
              role={centerHref ? "link" : undefined}
              tabIndex={centerHref ? 0 : undefined}
              aria-label={`${centerLabel}: ${centerValue}`}
              onClick={() => centerHref && router.push(centerHref)}
              onKeyDown={(event) => { if (centerHref && (event.key === "Enter" || event.key === " ")) router.push(centerHref); }}
              className={centerHref ? "cursor-pointer outline-none focus-visible:[&>circle]:stroke-foreground" : undefined}
            >
              <circle cx={CENTER_X} cy={CENTER_Y} r={58 * nodeScale} fill="color-mix(in srgb, var(--accent) 18%, var(--background))" stroke="var(--accent)" strokeWidth={2.5} />
              <text x={CENTER_X} y={CENTER_Y - 3} textAnchor="middle" fill="var(--foreground)" fontSize={15} fontWeight={600} pointerEvents="none">{shortLabel(centerLabel)}</text>
              <text x={CENTER_X} y={CENTER_Y + 19} textAnchor="middle" fill="var(--muted-foreground)" fontSize={12} pointerEvents="none">{centerValue.toLocaleString()}</text>
            </g>

            {positioned.map((node, index) => {
              const nodeColor = colorFor(node, colorMode);
              const nodeRadius = node.radius * nodeScale;
              const selectedNode = selected?.id === node.id;
              return (
                <g
                  key={node.id}
                  role={node.href ? "link" : "button"}
                  tabIndex={0}
                  aria-label={`${node.label}: ${node.value}${node.detail ? `. ${node.detail}` : ""}`}
                  transform={`translate(${node.x} ${node.y})`}
                  onPointerDown={(event) => startNodeDrag(event, node.id)}
                  onDoubleClick={() => node.href && router.push(node.href)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && node.href) router.push(node.href);
                    if (event.key === " ") { event.preventDefault(); setSelectedId(node.id); }
                  }}
                  className="cursor-grab outline-none focus-visible:[&>g>circle]:stroke-foreground"
                >
                  {/* One interpolated string, never several children: React supports a single
                      child in <title>, and given an array its server renderer emitted
                      `<title></title>`. That both broke hydration for the whole page and left
                      every node's native SVG tooltip empty in the server HTML. */}
                  <title>{`${node.label}: ${node.value}${node.detail ? ` · ${node.detail}` : ""}`}</title>
                  {/* The float lives on its own group so it composes with — rather than
                      overwrites — the positional transform above, which is what a drag
                      writes to. The selected bubble holds still: whatever you are reading
                      the detail panel for should not be moving while you read it. */}
                  <g
                    className="ambient-drift"
                    style={
                      selectedNode || !running
                        ? { ...driftStyle(index), animationName: "none" }
                        : driftStyle(index)
                    }
                  >
                    <circle className="data-flow-node-shape" r={nodeRadius} fill={`color-mix(in srgb, ${nodeColor} 22%, var(--background))`} stroke={selectedNode ? "var(--foreground)" : nodeColor} strokeWidth={selectedNode ? 3 : 1.8} />
                    <circle r={Math.max(2, nodeRadius * 0.12)} fill={nodeColor} opacity={node.value === 0 ? 0.35 : 0.9} />
                    <text y={nodeRadius + 17} textAnchor="middle" fill="var(--foreground)" fontSize={11.5} fontWeight={selectedNode ? 600 : 400} pointerEvents="none">{shortLabel(node.label)}</text>
                    <text y={nodeRadius + 32} textAnchor="middle" fill="var(--muted-foreground)" fontSize={10.5} pointerEvents="none">{node.value.toLocaleString()}</text>
                  </g>
                </g>
              );
            })}
          </g>
        </svg>

        {selected ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background px-4 py-3 text-sm" aria-live="polite">
            <div><span className="font-medium">{selected.label}</span><span className="text-muted-foreground"> · {selected.value.toLocaleString()}{selected.detail ? ` · ${selected.detail}` : ""}</span></div>
            {selected.href ? <Link href={selected.href} className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground">Open record →</Link> : null}
          </div>
        ) : null}
      </div>
    </details>
  );
}
