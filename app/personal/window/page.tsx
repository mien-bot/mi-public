import { connection } from "next/server";
import { PersonalWorkspace } from "@/components/PersonalWorkspace";
import { loadPersonalDatabase } from "@/lib/personal/store";

/**
 * The personal chat pop-out card, as its own route rather than `/personal?compactChat=1`.
 *
 * A card window draws its own titlebar over a `fixed inset-0` surface, which only works when
 * the app shell steps aside -- and both halves of that (Nav, RouteTransition) decide from the
 * pathname alone. Behind a query parameter this page kept the shell: the app header covered the
 * card's titlebar, so there was no way to close the window, and the route wrapper's transform
 * became the containing block for the fixed surface and collapsed it into a zero-height box, so
 * the window came up empty. Same shape as `/terminal/window`; registered in `isPaneWindowRoute`
 * alongside it.
 */
export default async function PersonalChatWindowPage({
  searchParams,
}: {
  searchParams: Promise<{ newChat?: string }>;
}) {
  await connection();
  const query = await searchParams;
  const loaded = loadPersonalDatabase();
  return (
    <PersonalWorkspace
      initialDatabase={loaded.database}
      initialHash={loaded.hash}
      startFresh={query.newChat === "1"}
      compact
    />
  );
}
