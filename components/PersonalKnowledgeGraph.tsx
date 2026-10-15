"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type {
  PersonalGraphLink,
  PersonalGraphNode,
  PersonalGraphNodeKind,
} from "@/lib/personal/analytics";
import { useAmbientMotionEnabled } from "@/lib/theme/useThemeMotion";

interface SimulationNode extends PersonalGraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

type DragState =
  | { kind: "node"; id: string; pointerId: number }
  | { kind: "pan"; x: number; y: number; panX: number; panY: number; pointerId: number }
  | null;

const WIDTH = 1000;
const HEIGHT = 620;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;

const kindColor: Record<PersonalGraphNodeKind, string> = {
  root: "var(--accent)",
  journal: "var(--viz-series-1, var(--accent))",
  thought: "var(--viz-series-2, var(--accent))",
  task: "var(--viz-series-3, var(--accent))",
  plan: "var(--viz-series-4, var(--accent))",
  schedule: "var(--viz-series-5, var(--accent))",
  chat: "var(--viz-series-6, var(--accent))",
  tag: "var(--muted-foreground)",
};

function initialNodes(nodes: PersonalGraphNode[]): SimulationNode[] {
  const peers = Math.max(1, nodes.length - 1);
  return nodes.map((node, index) => {
    if (node.kind === "root") return { ...node, x: CENTER_X, y: CENTER_Y, vx: 0, vy: 0 };
    const angle = ((index - 1) / peers) * Math.PI * 2;
    const ring = 150 + ((index - 1) % 4) * 34;
    return {
      ...node,
      x: CENTER_X + Math.cos(angle) * ring,
      y: CENTER_Y + Math.sin(angle) * ring,
      vx: 0,
      vy: 0,
    };
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function radius(node: PersonalGraphNode, scale: number): number {
  const base = node.kind === "root" ? 38 : 10 + Math.min(14, Math.sqrt(node.weight) * 3);
  return base * scale;
}

function shortLabel(label: string): string {
  return label.length > 28 ? `${label.slice(0, 27)}…` : label;
}

export function PersonalKnowledgeGraph({
  nodes,
  links,
}: {
  nodes: PersonalGraphNode[];
  links: PersonalGraphLink[];
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [renderedNodes, setRenderedNodes] = useState<SimulationNode[]>(() => initialNodes(nodes));
  const nodesRef = useRef<SimulationNode[]>(renderedNodes);
  const dragRef = useRef<DragState>(null);
  const frameRef = useRef<number | null>(null);
  const [nodeScale, setNodeScale] = useState(1);
  const [linkWidth, setLinkWidth] = useState(1.2);
  const [attraction, setAttraction] = useState(0.025);
  const [repulsion, setRepulsion] = useState(900);
  const [movement, setMovement] = useState(0.85);
  const [running, setRunning] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [selectedId, setSelectedId] = useState("personal-root");
  // Cinematic widens the wander term below so the field keeps visibly breathing instead of
  // settling into a near-still lattice. It never changes where a node comes to rest — only
  // how far it strays around that spot — so the graph's shape still reports the real links.
  const ambient = useAmbientMotionEnabled();
  const controlsRef = useRef({ nodeScale, attraction, repulsion, movement, ambient });

  useEffect(() => {
    controlsRef.current = { nodeScale, attraction, repulsion, movement, ambient };
  }, [nodeScale, attraction, repulsion, movement, ambient]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- apply the user's OS motion preference after hydration
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setRunning(false);
  }, []);

  useEffect(() => {
    if (!running) return;
    let previous = performance.now();
    let frameCount = 0;
    const animate = (time: number) => {
      const elapsed = clamp((time - previous) / 16.67, 0.35, 2);
      previous = time;
      const simulation = nodesRef.current;
      const byId = new Map(simulation.map((node) => [node.id, node]));
      const controls = controlsRef.current;

      for (const link of links) {
        const source = byId.get(link.source);
        const target = byId.get(link.target);
        if (!source || !target) continue;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const desired = source.kind === "root" ? 155 : 105;
        const force = (distance - desired) * controls.attraction * elapsed;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        source.vx += fx;
        source.vy += fy;
        target.vx -= fx;
        target.vy -= fy;
      }

      for (let left = 0; left < simulation.length; left += 1) {
        const a = simulation[left];
        for (let right = left + 1; right < simulation.length; right += 1) {
          const b = simulation[right];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          if (dx === 0 && dy === 0) {
            dx = 0.01 * (right + 1);
            dy = 0.01 * (left + 1);
          }
          const distanceSquared = Math.max(36, dx * dx + dy * dy);
          const distance = Math.sqrt(distanceSquared);
          const repel = (controls.repulsion / distanceSquared) * elapsed;
          const collision = radius(a, controls.nodeScale) + radius(b, controls.nodeScale) + 12;
          const collisionPush = distance < collision ? (collision - distance) * 0.035 * elapsed : 0;
          const force = repel + collisionPush;
          const fx = (dx / distance) * force;
          const fy = (dy / distance) * force;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }

      simulation.forEach((node, index) => {
        node.vx += (CENTER_X - node.x) * 0.0008 * elapsed;
        node.vy += (CENTER_Y - node.y) * 0.0008 * elapsed;
        const wander = controls.ambient ? 0.0065 : 0.0025;
        node.vx += Math.sin(time / 1200 + index * 1.7) * wander * controls.movement;
        node.vy += Math.cos(time / 1450 + index * 1.3) * wander * controls.movement;
        node.vx *= 0.9;
        node.vy *= 0.9;
        node.x = clamp(node.x + node.vx * controls.movement * elapsed, 35, WIDTH - 35);
        node.y = clamp(node.y + node.vy * controls.movement * elapsed, 35, HEIGHT - 35);
      });

      frameCount += 1;
      if (frameCount % 2 === 0) setRenderedNodes(simulation.map((node) => ({ ...node })));
      frameRef.current = requestAnimationFrame(animate);
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [links, running]);

  const nodeById = useMemo(
    () => new Map(renderedNodes.map((node) => [node.id, node])),
    [renderedNodes],
  );
  const selected = nodeById.get(selectedId) ?? renderedNodes[0];
  const visibleKinds = [...new Set(nodes.map((node) => node.kind))];

  function svgPoint(clientX: number, clientY: number): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg) return { x: clientX, y: clientY };
    const matrix = svg.getScreenCTM();
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
    dragRef.current = { kind: "node", id, pointerId: event.pointerId };
    setSelectedId(id);
  }

  function startPan(event: ReactPointerEvent<SVGRectElement>) {
    const point = svgPoint(event.clientX, event.clientY);
    svgRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = {
      kind: "pan",
      x: point.x,
      y: point.y,
      panX: pan.x,
      panY: pan.y,
      pointerId: event.pointerId,
    };
  }

  function movePointer(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.kind === "node") {
      const node = nodesRef.current.find((entry) => entry.id === drag.id);
      if (!node) return;
      const point = worldPoint(event.clientX, event.clientY);
      node.x = clamp(point.x, 25, WIDTH - 25);
      node.y = clamp(point.y, 25, HEIGHT - 25);
      node.vx = 0;
      node.vy = 0;
      setRenderedNodes(nodesRef.current.map((entry) => ({ ...entry })));
      return;
    }
    const point = svgPoint(event.clientX, event.clientY);
    setPan({ x: drag.panX + point.x - drag.x, y: drag.panY + point.y - drag.y });
  }

  function endPointer(event: ReactPointerEvent<SVGSVGElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
  }

  function zoomGraph(event: ReactWheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const point = svgPoint(event.clientX, event.clientY);
    const nextZoom = clamp(zoom * Math.exp(-event.deltaY * 0.001), 0.45, 3.5);
    const worldX = (point.x - pan.x) / zoom;
    const worldY = (point.y - pan.y) / zoom;
    setZoom(nextZoom);
    setPan({ x: point.x - worldX * nextZoom, y: point.y - worldY * nextZoom });
  }

  function resetView() {
    const resetNodes = initialNodes(nodes);
    nodesRef.current = resetNodes;
    setRenderedNodes(resetNodes);
    setPan({ x: 0, y: 0 });
    setZoom(1);
    setSelectedId("personal-root");
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-medium">Personal knowledge graph</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Drag nodes, drag the background to pan, and scroll over the graph to zoom. Titles and metadata stay local to this Personal workspace.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setRunning((value) => !value)} className="rounded-md border border-border px-3 py-2 text-sm hover:border-accent">
            {running ? "Pause motion" : "Resume motion"}
          </button>
          <button type="button" onClick={resetView} className="rounded-md border border-border px-3 py-2 text-sm hover:border-accent">Reset view</button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <label className="text-xs text-muted-foreground">Node size · {nodeScale.toFixed(1)}×
          <input className="mt-1 w-full accent-accent" type="range" min="0.6" max="2" step="0.1" value={nodeScale} onChange={(event) => setNodeScale(Number(event.target.value))} />
        </label>
        <label className="text-xs text-muted-foreground">Connection size · {linkWidth.toFixed(1)} px
          <input className="mt-1 w-full accent-accent" type="range" min="0.5" max="4" step="0.1" value={linkWidth} onChange={(event) => setLinkWidth(Number(event.target.value))} />
        </label>
        <label className="text-xs text-muted-foreground">Attraction · {attraction.toFixed(3)}
          <input className="mt-1 w-full accent-accent" type="range" min="0.005" max="0.08" step="0.005" value={attraction} onChange={(event) => setAttraction(Number(event.target.value))} />
        </label>
        <label className="text-xs text-muted-foreground">Repulsion · {repulsion}
          <input className="mt-1 w-full accent-accent" type="range" min="150" max="3000" step="50" value={repulsion} onChange={(event) => setRepulsion(Number(event.target.value))} />
        </label>
        <label className="text-xs text-muted-foreground">Movement · {movement.toFixed(2)}×
          <input className="mt-1 w-full accent-accent" type="range" min="0.15" max="1.8" step="0.05" value={movement} onChange={(event) => setMovement(Number(event.target.value))} />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground" aria-label="Node types">
        {visibleKinds.map((kind) => (
          <span key={kind} className="flex items-center gap-1.5 capitalize">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: kindColor[kind] }} aria-hidden="true" />
            {kind}
          </span>
        ))}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Interactive personal knowledge graph with ${nodes.length} nodes and ${links.length} connections`}
        onPointerMove={movePointer}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onWheel={zoomGraph}
        className="mt-4 h-[min(44rem,70vh)] min-h-[30rem] w-full touch-none overflow-hidden rounded-lg border border-border bg-background"
      >
        <rect width={WIDTH} height={HEIGHT} fill="transparent" onPointerDown={startPan} />
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {links.map((link, index) => {
            const source = nodeById.get(link.source);
            const target = nodeById.get(link.target);
            if (!source || !target) return null;
            // The dash pattern that makes the charge readable is applied by CSS at the
            // Cinematic level only (see .edge-charge in app/globals.css), so these stay the
            // plain solid links they have always been at every other level.
            return <line key={`${link.source}:${link.target}:${index}`} className="edge-charge" x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke="var(--border)" strokeWidth={linkWidth} />;
          })}
          {renderedNodes.map((node) => {
            const nodeRadius = radius(node, nodeScale);
            const selectedNode = selectedId === node.id;
            return (
              <g
                key={node.id}
                role="button"
                tabIndex={0}
                aria-label={`${node.label}, ${node.detail}`}
                transform={`translate(${node.x} ${node.y})`}
                onPointerDown={(event) => startNodeDrag(event, node.id)}
                onClick={() => setSelectedId(node.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") setSelectedId(node.id);
                }}
                className="cursor-grab outline-none focus-visible:[&>circle]:stroke-foreground"
              >
                <title>{`${node.label} · ${node.detail}`}</title>
                <circle
                  className="data-flow-node-shape"
                  r={nodeRadius}
                  fill={`color-mix(in srgb, ${kindColor[node.kind]} 28%, var(--background))`}
                  stroke={selectedNode ? "var(--foreground)" : kindColor[node.kind]}
                  strokeWidth={selectedNode ? 3 : 1.5}
                />
                <text y={node.kind === "root" ? 4 : nodeRadius + 16} textAnchor="middle" fill="var(--foreground)" fontSize={node.kind === "root" ? 17 : 12} fontWeight={node.kind === "root" ? 500 : 400} pointerEvents="none">
                  {shortLabel(node.label)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {selected && (
        <p className="mt-3 text-sm" aria-live="polite">
          <span className="font-medium">{selected.label}</span>
          <span className="text-muted-foreground"> · {selected.detail}</span>
        </p>
      )}
    </section>
  );
}
