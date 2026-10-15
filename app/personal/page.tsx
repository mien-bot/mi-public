import { connection } from "next/server";
import { redirect } from "next/navigation";
import { PersonalWorkspace } from "@/components/PersonalWorkspace";
import { loadPersonalDatabase } from "@/lib/personal/store";

export default async function PersonalPage({
  searchParams,
}: {
  searchParams: Promise<{ newChat?: string; compactChat?: string }>;
}) {
  await connection();
  const query = await searchParams;
  // The compact surface lives at /personal/window, which isPaneWindowRoute knows to strip the
  // app shell for. Rendering it here instead is what produced an empty, unclosable card.
  if (query.compactChat === "1") redirect("/personal/window");
  const loaded = loadPersonalDatabase();
  return (
    <PersonalWorkspace
      initialDatabase={loaded.database}
      initialHash={loaded.hash}
      startFresh={query.newChat === "1"}
    />
  );
}
