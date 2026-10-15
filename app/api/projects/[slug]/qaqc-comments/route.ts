import { getProjectSlugs, getReviews } from "@/lib/content";
import { buildReviewCommentCsv } from "@/lib/bluebeam/commentRegister";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) {
    return Response.json({ error: "Project not found." }, { status: 404 });
  }
  const reviews = getReviews(slug);
  const csv = buildReviewCommentCsv(reviews.map((review) => ({
    id: review.slug,
    frontmatter: review.frontmatter,
    contentMarkdown: review.contentMarkdown,
  })));
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-qaqc-comments.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
