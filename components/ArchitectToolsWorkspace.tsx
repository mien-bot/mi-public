"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import {
  compareEpds,
  type ArchitectSource,
  type ArchitectToolkit,
  type ArchitectToolOperation,
  type ChicagoSiteStudy,
  type EpdRecord,
  type OccupancyStudy,
  type OutlineSpecification,
  type ProductRecord,
  type TimeReconstruction,
  type WorkplaceProgram,
} from "@/lib/architectTools";

export interface TimeEvidenceCandidate {
  id: string;
  date: string;
  label: string;
  description: string;
  path: string;
}

const CHICAGO_SOURCES = [
  ["Chicago zoning districts", "https://data.cityofchicago.org/Community-Economic-Development/Boundaries-Zoning-Districts-current-/7cve-jgbp"],
  ["Chicago building permits", "https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu"],
  ["Chicago building violations", "https://data.cityofchicago.org/Buildings/Building-Violations/22u3-xenr"],
  ["Chicago individual landmarks", "https://data.cityofchicago.org/Historic-Preservation/Individual-Landmarks/uct4-hrvh"],
  ["Cook County property search", "https://www.cookcountyassessor.com/address-search"],
  ["Illinois EPA site remediation", "https://epa.illinois.gov/topics/cleanup-programs/bol-database/srp.html"],
  ["Illinois EPA facility inventory", "https://epa.illinois.gov/topics/cleanup-programs/bol-database/afiis.html"],
  ["FEMA flood maps", "https://msc.fema.gov/portal/home"],
  ["US EPA Envirofacts", "https://www.epa.gov/enviro/envirofacts-overview"],
] as const;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1 text-sm"><span className="text-muted-foreground">{label}</span>{children}</label>;
}

function LinesHelp({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

function Card({ title, intro, children }: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <details className="rounded-lg border border-border bg-card p-5">
      <summary className="cursor-pointer list-none">
        <h2 className="inline font-medium">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{intro}</p>
      </summary>
      <div className="mt-5 border-t border-border pt-5">{children}</div>
    </details>
  );
}

function stringValue(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

function numberValue(form: FormData, name: string): number {
  return Number(stringValue(form, name));
}

function lines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function parts(value: string, count: number, example: string): string[][] {
  return lines(value).map((line) => {
    const values = line.split("|").map((part) => part.trim());
    if (values.length < count || values.slice(0, count).some((part) => !part)) {
      throw new Error(`Use ${example} on each line.`);
    }
    return values;
  });
}

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().replaceAll("-", "")}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function source(form: FormData, prefix = "source"): ArchitectSource {
  return {
    title: stringValue(form, `${prefix}Title`),
    url: stringValue(form, `${prefix}Url`),
    accessed_on: today(),
    authority: stringValue(form, `${prefix}Authority`),
    section: stringValue(form, `${prefix}Section`),
    notes: "",
  };
}

function SourceFields({ prefix = "source", authority = "" }: {
  prefix?: string;
  authority?: string;
}) {
  return (
    <div className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-2">
      <Field label="Source title"><input required name={`${prefix}Title`} className="control" /></Field>
      <Field label="Authority / publisher"><input required name={`${prefix}Authority`} defaultValue={authority} className="control" /></Field>
      <Field label="Official source URL"><input required name={`${prefix}Url`} type="url" className="control md:col-span-2" /></Field>
      <Field label="Code section, table, page, or dataset field"><input name={`${prefix}Section`} className="control md:col-span-2" /></Field>
    </div>
  );
}

function SubmitButton({ children }: { children: ReactNode }) {
  return <button type="submit" className="rounded-md bg-foreground px-4 py-2 text-sm text-background">{children}</button>;
}

function SavedList({ children, empty }: { children: ReactNode; empty: boolean }) {
  return empty
    ? <p className="text-sm text-muted-foreground">No project records saved yet.</p>
    : <div className="grid gap-2">{children}</div>;
}

function SavedRow({ title, detail }: { title: string; detail: string }) {
  return <div className="rounded-md border border-border px-3 py-2"><p className="text-sm font-medium">{title}</p><p className="text-xs text-muted-foreground">{detail}</p></div>;
}

export function ArchitectToolsWorkspace({
  slug,
  initialToolkit,
  timeEvidence,
}: {
  slug: string;
  initialToolkit: ArchitectToolkit;
  timeEvidence: TimeEvidenceCandidate[];
}) {
  const [mounted, setMounted] = useState(false);
  const [toolkit, setToolkit] = useState(initialToolkit);
  const [pending, setPending] = useState<{
    operation: ArchitectToolOperation;
    expectedHash: string | null;
    label: string;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [leftEpd, setLeftEpd] = useState("");
  const [rightEpd, setRightEpd] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- desktop capability exists only after hydration
    setMounted(true);
  }, []);
  const desktop = mounted && Boolean(window.electronAPI);

  async function preview(operation: ArchitectToolOperation, label: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/architect-tools`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: false, operation }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setPending({ operation, expectedHash: data.expectedHash, label });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The draft could not be previewed.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/architect-tools`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmed: true,
          operation: pending.operation,
          expectedHash: pending.expectedHash,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setToolkit(data.toolkit);
      setPending(null);
      setMessage(`${pending.label} saved to this project as a review-required record.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The record could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  function submit(
    event: FormEvent<HTMLFormElement>,
    build: (form: FormData) => ArchitectToolOperation,
    label: string,
  ) {
    event.preventDefault();
    try {
      void preview(build(new FormData(event.currentTarget)), label);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Check the form values.");
    }
  }

  const comparison = useMemo(() => {
    const left = toolkit.epds.find((entry) => entry.id === leftEpd);
    const right = toolkit.epds.find((entry) => entry.id === rightEpd);
    return left && right && left.id !== right.id ? compareEpds(left, right) : null;
  }, [leftEpd, rightEpd, toolkit.epds]);

  return (
    <div className="grid gap-5">
      <div className="rounded-lg border border-status-warning-foreground/40 bg-status-warning/30 p-4 text-sm">
        <p className="font-medium">Professional review boundary</p>
        <p className="mt-1 text-muted-foreground">
          These tools organize calculations and research; they do not make a code, zoning,
          environmental, product, or billing determination. Factors and findings need cited
          sources. Every save has a separate review step and stays project-local.
        </p>
      </div>

      {!desktop && mounted && (
        <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          Architect Tools are read-only on iPhone and in a browser. Saved studies and libraries
          remain visible below; use the Mi Mac app to create or confirm a record.
        </div>
      )}

      {message && <p role="status" className="rounded-md border border-border p-3 text-sm">{message}</p>}

      <Card
        title="Occupancy calculator"
        intro="Calculates each occupant load with an explicit Chicago code edition, source, gross/net basis, and round-up rule. Mi does not invent or preload the regulatory factor."
      >
        {desktop && (
          <form className="grid gap-3" onSubmit={(event) => submit(event, (form) => {
            const areaRows = parts(stringValue(form, "areas"), 4, "Area name | square feet | factor | gross or net");
            const areas = areaRows.map(([name, area, factor, basis], index) => {
              const areaSf = Number(area);
              const factorValue = Number(factor);
              return {
                id: `area-${index + 1}`,
                name,
                area_sf: areaSf,
                factor_sf_per_person: factorValue,
                basis: basis.toLowerCase() as "gross" | "net",
                occupants: Math.ceil(areaSf / factorValue),
              };
            });
            const value: OccupancyStudy = {
              id: id("occupancy"),
              title: stringValue(form, "title"),
              jurisdiction: "Chicago, Illinois",
              code_edition: stringValue(form, "codeEdition"),
              created_at: new Date().toISOString(),
              areas,
              total_occupants: areas.reduce((sum, area) => sum + area.occupants, 0),
              assumptions: lines(stringValue(form, "assumptions")),
              sources: [source(form)],
              status: "draft",
              reviewed_by: null,
              professional_review_required: true,
            };
            return { kind: "add-occupancy-study", value };
          }, "Occupancy study")}>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Study title"><input required name="title" className="control" /></Field>
              <Field label="Chicago code edition"><input required name="codeEdition" placeholder="Edition verified by project team" className="control" /></Field>
            </div>
            <Field label="Areas"><textarea required name="areas" rows={4} className="control" placeholder={"Business area | 2500 | 150 | gross\nConference room | 450 | 15 | net"} /></Field>
            <LinesHelp>One line per area: name | area in square feet | cited factor | gross or net.</LinesHelp>
            <Field label="Assumptions"><textarea name="assumptions" rows={2} className="control" placeholder="One assumption per line" /></Field>
            <SourceFields authority="City of Chicago" />
            <SubmitButton>Preview occupancy study</SubmitButton>
          </form>
        )}
        <div className="mt-5">
          <SavedList empty={toolkit.occupancy_studies.length === 0}>
            {toolkit.occupancy_studies.map((study) => <SavedRow key={study.id} title={study.title} detail={`${study.total_occupants} calculated occupants · ${study.code_edition} · ${study.status}`} />)}
          </SavedList>
        </div>
      </Card>

      <Card
        title="Workplace programming"
        intro="Turns headcount, area, work policy, zone percentages, and room assumptions into a reviewable area program with visible tradeoffs."
      >
        {desktop && (
          <form className="grid gap-3" onSubmit={(event) => submit(event, (form) => {
            const totalArea = numberValue(form, "totalArea");
            const zones = parts(stringValue(form, "zones"), 2, "Zone name | percentage").map(([name, percentage]) => ({
              name,
              percentage: Number(percentage),
              area_sf: Math.round(totalArea * Number(percentage)) / 100,
            }));
            const roomText = stringValue(form, "rooms");
            const rooms = roomText ? parts(roomText, 4, "Room name | count | capacity | square feet each").map(([name, count, capacity, area]) => ({
              name,
              count: Number(count),
              capacity_each: Number(capacity),
              area_each_sf: Number(area),
            })) : [];
            const value: WorkplaceProgram = {
              id: id("workplace"),
              title: stringValue(form, "title"),
              created_at: new Date().toISOString(),
              headcount: numberValue(form, "headcount"),
              total_area_sf: totalArea,
              work_policy: stringValue(form, "workPolicy"),
              zones,
              rooms,
              assumptions: lines(stringValue(form, "assumptions")),
              tradeoffs: lines(stringValue(form, "tradeoffs")),
              status: "draft",
              reviewed_by: null,
              professional_review_required: true,
            };
            return { kind: "add-workplace-program", value };
          }, "Workplace program")}>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Program title"><input required name="title" className="control" /></Field>
              <Field label="Headcount"><input required name="headcount" type="number" min="1" className="control" /></Field>
              <Field label="Total usable area (sf)"><input required name="totalArea" type="number" min="1" step="0.01" className="control" /></Field>
            </div>
            <Field label="Work policy"><textarea required name="workPolicy" rows={2} className="control" placeholder="Example: hybrid, three anchor days, 0.8 desks per person" /></Field>
            <Field label="Zones"><textarea required name="zones" rows={5} className="control" defaultValue={"Focus | 35\nCollaboration | 25\nSocial | 15\nSupport | 15\nCirculation | 10"} /></Field>
            <LinesHelp>One line per zone: name | percentage. Percentages must total 100.</LinesHelp>
            <Field label="Rooms"><textarea name="rooms" rows={3} className="control" placeholder="Conference room | 2 | 8 | 220" /></Field>
            <LinesHelp>Optional: room name | count | capacity each | square feet each.</LinesHelp>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Assumptions"><textarea name="assumptions" rows={3} className="control" /></Field>
              <Field label="Tradeoffs"><textarea name="tradeoffs" rows={3} className="control" /></Field>
            </div>
            <SubmitButton>Preview workplace program</SubmitButton>
          </form>
        )}
        <div className="mt-5">
          <SavedList empty={toolkit.workplace_programs.length === 0}>
            {toolkit.workplace_programs.map((program) => <SavedRow key={program.id} title={program.title} detail={`${program.headcount} people · ${program.total_area_sf.toLocaleString()} sf · ${program.zones.length} zones`} />)}
          </SavedList>
        </div>
      </Card>

      <Card
        title="Evidence-based time reconstruction"
        intro="Meeting, decision, and site-report evidence can suggest what happened and when. It never suggests a duration; the person entering time must supply and confirm the hours."
      >
        {desktop && timeEvidence.length > 0 && (
          <form className="grid gap-3" onSubmit={(event) => submit(event, (form) => {
            const evidence = timeEvidence.find((item) => item.id === stringValue(form, "evidence"));
            if (!evidence) throw new Error("Choose a project evidence record.");
            const value: TimeReconstruction = {
              id: id("time"),
              date: evidence.date,
              person: stringValue(form, "person"),
              description: stringValue(form, "description") || evidence.description,
              hours: numberValue(form, "hours"),
              evidence_label: evidence.label,
              evidence_path: evidence.path,
              entered_by: stringValue(form, "enteredBy"),
              entered_at: new Date().toISOString(),
              notes: stringValue(form, "notes"),
              status: "human-confirmed",
            };
            return { kind: "add-time-reconstruction", value };
          }, "Time reconstruction")}>
            <Field label="Evidence record">
              <select required name="evidence" className="control" defaultValue="">
                <option value="" disabled>Choose meeting, decision, or site report</option>
                {timeEvidence.map((item) => <option key={item.id} value={item.id}>{item.date} · {item.label}</option>)}
              </select>
            </Field>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Person whose time this is"><input required name="person" className="control" /></Field>
              <Field label="Hours supplied by that person"><input required name="hours" type="number" min="0.01" max="24" step="0.01" className="control" /></Field>
              <Field label="Entered by"><input required name="enteredBy" className="control" /></Field>
            </div>
            <Field label="Description"><textarea name="description" rows={2} className="control" placeholder="Leave blank to use the evidence summary" /></Field>
            <Field label="Notes"><textarea name="notes" rows={2} className="control" /></Field>
            <SubmitButton>Review human-supplied hours</SubmitButton>
          </form>
        )}
        {desktop && timeEvidence.length === 0 && <p className="text-sm text-muted-foreground">Add a meeting, decision, or site report first; Mi will use it as evidence without guessing a duration.</p>}
        <div className="mt-5">
          <SavedList empty={toolkit.time_reconstructions.length === 0}>
            {toolkit.time_reconstructions.map((entry) => <SavedRow key={entry.id} title={`${entry.person} · ${entry.hours} hours`} detail={`${entry.date} · ${entry.evidence_label} · entered by ${entry.entered_by}`} />)}
          </SavedList>
        </div>
      </Card>

      <Card
        title="CSI outline specifications"
        intro="Captures a MasterFormat section as a three-part outline. The result is deliberately marked for review and does not claim to be a construction-ready specification."
      >
        {desktop && (
          <form className="grid gap-3" onSubmit={(event) => submit(event, (form) => {
            const value: OutlineSpecification = {
              id: id("spec"),
              title: stringValue(form, "title"),
              created_at: new Date().toISOString(),
              division: stringValue(form, "division"),
              section_number: stringValue(form, "sectionNumber"),
              section_title: stringValue(form, "sectionTitle"),
              part_1_general: lines(stringValue(form, "part1")),
              part_2_products: lines(stringValue(form, "part2")),
              part_3_execution: lines(stringValue(form, "part3")),
              sources: [source(form)],
              status: "draft",
              reviewed_by: null,
              professional_review_required: true,
            };
            return { kind: "add-outline-specification", value };
          }, "Outline specification")}>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Draft title"><input required name="title" className="control" /></Field>
              <Field label="Division"><input required name="division" placeholder="Division 08 — Openings" className="control" /></Field>
              <Field label="Section number"><input required name="sectionNumber" placeholder="08 41 13" className="control" /></Field>
            </div>
            <Field label="Section title"><input required name="sectionTitle" className="control" /></Field>
            <div className="grid gap-3 lg:grid-cols-3">
              <Field label="Part 1 — General"><textarea required name="part1" rows={6} className="control" placeholder="One requirement per line" /></Field>
              <Field label="Part 2 — Products"><textarea required name="part2" rows={6} className="control" placeholder="One requirement per line" /></Field>
              <Field label="Part 3 — Execution"><textarea required name="part3" rows={6} className="control" placeholder="One requirement per line" /></Field>
            </div>
            <SourceFields />
            <SubmitButton>Preview outline specification</SubmitButton>
          </form>
        )}
        <div className="mt-5">
          <SavedList empty={toolkit.outline_specifications.length === 0}>
            {toolkit.outline_specifications.map((spec) => <SavedRow key={spec.id} title={`${spec.section_number} — ${spec.section_title}`} detail={`${spec.division} · ${spec.status} · professional review required`} />)}
          </SavedList>
        </div>
      </Card>

      <Card
        title="Product and FF&E library"
        intro="Stores project candidates with the exact manufacturer source used for research. Selection is a separate human decision."
      >
        {desktop && (
          <form className="grid gap-3" onSubmit={(event) => submit(event, (form) => {
            const value: ProductRecord = {
              id: id("product"),
              category: stringValue(form, "category"),
              manufacturer: stringValue(form, "manufacturer"),
              product_name: stringValue(form, "productName"),
              model: stringValue(form, "model"),
              source: source(form),
              notes: stringValue(form, "notes"),
              status: "candidate",
              selected_by: null,
            };
            return { kind: "add-product", value };
          }, "Product candidate")}>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <Field label="Category"><input required name="category" className="control" /></Field>
              <Field label="Manufacturer"><input required name="manufacturer" className="control" /></Field>
              <Field label="Product"><input required name="productName" className="control" /></Field>
              <Field label="Model"><input name="model" className="control" /></Field>
            </div>
            <Field label="Notes"><textarea name="notes" rows={2} className="control" /></Field>
            <SourceFields />
            <SubmitButton>Preview product candidate</SubmitButton>
          </form>
        )}
        <div className="mt-5">
          <SavedList empty={toolkit.products.length === 0}>
            {toolkit.products.map((product) => <SavedRow key={product.id} title={`${product.manufacturer} ${product.product_name}`} detail={`${product.category} · ${product.status}${product.model ? ` · ${product.model}` : ""}`} />)}
          </SavedList>
        </div>
      </Card>

      <Card
        title="EPD library and comparison"
        intro="Records declared unit, system boundary, PCR, standard, validity, and GWP. Mi blocks a numeric comparison when these foundations do not match."
      >
        {desktop && toolkit.products.length > 0 && (
          <form className="grid gap-3" onSubmit={(event) => submit(event, (form) => {
            const value: EpdRecord = {
              id: id("epd"),
              product_id: stringValue(form, "productId"),
              declared_unit: stringValue(form, "declaredUnit"),
              system_boundary: stringValue(form, "systemBoundary"),
              pcr: stringValue(form, "pcr"),
              standard: stringValue(form, "standard"),
              valid_through: stringValue(form, "validThrough"),
              gwp_value: numberValue(form, "gwpValue"),
              gwp_unit: stringValue(form, "gwpUnit"),
              source: source(form),
              notes: stringValue(form, "notes"),
              professional_review_required: true,
            };
            return { kind: "add-epd", value };
          }, "EPD record")}>
            <Field label="Product">
              <select required name="productId" className="control">
                {toolkit.products.map((product) => <option key={product.id} value={product.id}>{product.manufacturer} · {product.product_name}</option>)}
              </select>
            </Field>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <Field label="Declared unit"><input required name="declaredUnit" className="control" /></Field>
              <Field label="System boundary"><input required name="systemBoundary" placeholder="A1-A3" className="control" /></Field>
              <Field label="PCR"><input required name="pcr" className="control" /></Field>
              <Field label="Standard"><input required name="standard" placeholder="ISO 14025 / EN 15804" className="control" /></Field>
              <Field label="Valid through"><input required name="validThrough" type="date" className="control" /></Field>
              <Field label="GWP value"><input required name="gwpValue" type="number" min="0" step="any" className="control" /></Field>
              <Field label="GWP unit"><input required name="gwpUnit" placeholder="kg CO2e" className="control" /></Field>
            </div>
            <Field label="Notes"><textarea name="notes" rows={2} className="control" /></Field>
            <SourceFields />
            <SubmitButton>Preview EPD record</SubmitButton>
          </form>
        )}
        {desktop && toolkit.products.length === 0 && <p className="text-sm text-muted-foreground">Add a product candidate before attaching its EPD.</p>}
        {toolkit.epds.length >= 2 && (
          <div className="mt-5 rounded-md border border-border p-4">
            <h3 className="text-sm font-medium">Comparability gate</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <select value={leftEpd} onChange={(event) => setLeftEpd(event.target.value)} className="control"><option value="">First EPD</option>{toolkit.epds.map((epd) => <option key={epd.id} value={epd.id}>{epd.id} · {epd.gwp_value} {epd.gwp_unit}</option>)}</select>
              <select value={rightEpd} onChange={(event) => setRightEpd(event.target.value)} className="control"><option value="">Second EPD</option>{toolkit.epds.map((epd) => <option key={epd.id} value={epd.id}>{epd.id} · {epd.gwp_value} {epd.gwp_unit}</option>)}</select>
            </div>
            {comparison && (
              <p className={`mt-3 text-sm ${comparison.comparable ? "" : "text-status-warning-foreground"}`}>
                {comparison.comparable
                  ? `${comparison.lowerGwpEpdId ?? "Neither record"} has the lower GWP; difference ${comparison.difference?.toLocaleString()} (${comparison.percentDifference?.toFixed(1)}%).`
                  : `Comparison blocked: ${comparison.blockers.join(" ")}`}
              </p>
            )}
          </div>
        )}
        <div className="mt-5">
          <SavedList empty={toolkit.epds.length === 0}>
            {toolkit.epds.map((epd) => <SavedRow key={epd.id} title={`${epd.gwp_value} ${epd.gwp_unit} · ${epd.declared_unit}`} detail={`${epd.system_boundary} · ${epd.standard} · valid through ${epd.valid_through}`} />)}
          </SavedList>
        </div>
      </Card>

      <Card
        title="Chicago property and environmental due diligence"
        intro="A Chicago/Illinois source checklist for property, zoning, permit, violation, landmark, flood, environmental, and geotechnical findings."
      >
        <div className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {CHICAGO_SOURCES.map(([label, url]) => <a key={url} href={url} target="_blank" rel="noreferrer" className="rounded-md border border-border px-3 py-2 text-sm hover:border-accent">{label} ↗</a>)}
        </div>
        {desktop && (
          <form className="grid gap-3" onSubmit={(event) => submit(event, (form) => {
            const findingRows = parts(stringValue(form, "findings"), 3, "category | status | summary");
            const value: ChicagoSiteStudy = {
              id: id("chicago-site"),
              title: stringValue(form, "title"),
              created_at: new Date().toISOString(),
              jurisdiction: "Chicago, Illinois",
              address: stringValue(form, "address"),
              pin: stringValue(form, "pin"),
              zoning_district: stringValue(form, "zoning"),
              findings: findingRows.map(([category, status, summary]) => ({
                category: category.toLowerCase() as ChicagoSiteStudy["findings"][number]["category"],
                status: status.toLowerCase() as ChicagoSiteStudy["findings"][number]["status"],
                summary,
                source_ids: [0],
              })),
              sources: [source(form)],
              gaps: lines(stringValue(form, "gaps")),
              status: "draft",
              reviewed_by: null,
              professional_review_required: true,
            };
            return { kind: "add-chicago-site-study", value };
          }, "Chicago site study")}>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Study title"><input required name="title" className="control" /></Field>
              <Field label="Chicago address"><input required name="address" className="control" /></Field>
              <Field label="Cook County PIN, if human-confirmed"><input name="pin" className="control" /></Field>
              <Field label="Zoning district, if verified"><input name="zoning" className="control" /></Field>
            </div>
            <Field label="Findings"><textarea required name="findings" rows={5} className="control" placeholder={"zoning | result-found | District shown by current city zoning map\npermits | needs-review | Permit history needs project-team review"} /></Field>
            <LinesHelp>Category: property, zoning, permits, violations, landmarks, flood, environmental, geotechnical, or other. Status: not-checked, no-result-found, result-found, or needs-review.</LinesHelp>
            <Field label="Known gaps and next checks"><textarea required name="gaps" rows={3} className="control" placeholder="One limitation or missing check per line" /></Field>
            <SourceFields authority="City of Chicago / Cook County / Illinois EPA / federal agency" />
            <SubmitButton>Preview Chicago site study</SubmitButton>
          </form>
        )}
        <div className="mt-5">
          <SavedList empty={toolkit.chicago_site_studies.length === 0}>
            {toolkit.chicago_site_studies.map((study) => <SavedRow key={study.id} title={study.title} detail={`${study.address} · ${study.findings.length} findings · ${study.gaps.length} known gaps`} />)}
          </SavedList>
        </div>
      </Card>

      {pending && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="architect-confirm-title" className="w-full max-w-lg rounded-lg border border-border bg-card p-5">
            <h2 id="architect-confirm-title" className="font-medium">Confirm project record</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Save “{pending.label}” to this project&apos;s Architect Tools file? It remains
              marked as draft or human-confirmed evidence and does not approve a professional
              conclusion, select a product, create a bill, or write to Notion.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button disabled={busy} type="button" onClick={() => setPending(null)} className="rounded-md border border-border px-3 py-2 text-sm">Cancel</button>
              <button disabled={busy} type="button" onClick={() => void confirm()} className="rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-40">{busy ? "Saving…" : "Confirm local save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
