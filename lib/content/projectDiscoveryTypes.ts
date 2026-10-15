export interface ProjectFile {
  id: string;
  source: "dropbox" | "local";
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  revision: string;
  output: boolean;
  href: string;
}

export interface ProjectHandoff {
  version: 1;
  id: string;
  title: string;
  summary: string;
  nextSteps: string;
  openQuestions: string;
  author: string;
  provider: string;
  files: Array<{ source: "dropbox" | "local"; path: string; revision: string }>;
  createdAt: string;
}

export interface ProjectChange {
  id: string;
  revision: string;
  label: string;
  kind: "file" | "record" | "handoff";
  href: string;
}

export interface ProjectDiscovery {
  slug: string;
  projectName: string;
  files: ProjectFile[];
  handoffs: ProjectHandoff[];
  changes: ProjectChange[];
  scannedAt: string;
  complete: boolean;
  warnings: string[];
  shared: boolean;
  destination: string;
}
