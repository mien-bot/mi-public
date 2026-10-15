import fs from "node:fs";
import path from "node:path";
import {
  libraryCollectionMetaSchema,
  libraryIndexSchema,
  type LibraryDocument,
} from "@/lib/schema";
import { listDirs, readYamlFileIfExists } from "./fsUtils";
import { LIBRARY_DIR } from "./paths";

export interface LibraryCollection {
  slug: string;
  name: string;
  documents: LibraryDocument[];
}

export function getLibraryCollectionSlugs(): string[] {
  return listDirs(LIBRARY_DIR).filter((slug) => !slug.startsWith("."));
}

export function getLibraryCollectionName(collectionSlug: string): string {
  const filePath = path.join(LIBRARY_DIR, collectionSlug, "collection.yaml");
  if (!fs.existsSync(filePath)) return collectionSlug;
  return readYamlFileIfExists(
    filePath,
    (data) => libraryCollectionMetaSchema.parse(data).name,
    collectionSlug,
  );
}

export function getLibraryDocuments(collectionSlug: string): LibraryDocument[] {
  const filePath = path.join(LIBRARY_DIR, collectionSlug, "index.yaml");
  return readYamlFileIfExists(filePath, (data) => libraryIndexSchema.parse(data ?? []), []);
}

export function getAllLibraryCollections(): LibraryCollection[] {
  return getLibraryCollectionSlugs().map((slug) => ({
    slug,
    name: getLibraryCollectionName(slug),
    documents: getLibraryDocuments(slug),
  }));
}
