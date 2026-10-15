import Link from "next/link";
import { notFound } from "next/navigation";
import { computeBudgetStatus, getBudget, getBudgetVariance, getProject, getProjectSlugs } from "@/lib/content";
import { StatusBadge } from "@/components/StatusBadge";

export function generateStaticParams() {
  return getProjectSlugs().map((slug) => ({ slug }));
}

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(
    amount,
  );
}

export default async function BudgetPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const slugs = new Set(getProjectSlugs());
  if (!slugs.has(slug)) notFound();

  const project = getProject(slug);
  const budget = getBudget(slug);
  const variance = getBudgetVariance(slug);
  const varianceByName = new Map(variance.map((v) => [v.name, v]));

  const totals = budget.categories.reduce(
    (acc, c) => ({
      budgeted: acc.budgeted + c.budgeted,
      committed: acc.committed + c.committed,
      actual: acc.actual + c.actual,
    }),
    { budgeted: 0, committed: 0, actual: 0 },
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/projects/${slug}`} className="text-sm text-muted-foreground hover:underline">
          ← {project.meta.name}
        </Link>
        <h1 className="mt-1 font-display text-2xl font-light tracking-wide">Budget</h1>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Category</th>
            <th className="py-2 pr-4 text-right font-medium">Budgeted</th>
            <th className="py-2 pr-4 text-right font-medium">Committed</th>
            <th className="py-2 pr-4 text-right font-medium">Actual</th>
            <th className="py-2 pr-4 text-right font-medium">Variance</th>
            <th className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {budget.categories.map((c) => {
            const status = computeBudgetStatus(c);
            const v = varianceByName.get(c.name);
            return (
              <tr key={c.name} className="border-b border-border/60">
                <td className="py-2 pr-4">{c.name}</td>
                <td className="py-2 pr-4 text-right text-muted-foreground">
                  {formatCurrency(c.budgeted, c.currency)}
                </td>
                <td className="py-2 pr-4 text-right text-muted-foreground">
                  {formatCurrency(c.committed, c.currency)}
                </td>
                <td
                  className={`py-2 pr-4 text-right font-medium ${
                    status === "over" ? "text-red-600 dark:text-red-400" : ""
                  }`}
                >
                  {formatCurrency(c.actual, c.currency)}
                </td>
                <td className="py-2 pr-4 text-right text-muted-foreground">
                  {v && (
                    <>
                      {v.variance >= 0 ? "+" : ""}
                      {formatCurrency(v.variance, c.currency)} ({v.percentVariance >= 0 ? "+" : ""}
                      {v.percentVariance}%)
                    </>
                  )}
                </td>
                <td className="py-2">
                  <StatusBadge status={status} />
                </td>
              </tr>
            );
          })}
        </tbody>
        {budget.categories.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-border-strong font-medium">
              <td className="py-2 pr-4">Total</td>
              <td className="py-2 pr-4 text-right">{formatCurrency(totals.budgeted, "USD")}</td>
              <td className="py-2 pr-4 text-right">{formatCurrency(totals.committed, "USD")}</td>
              <td className="py-2 pr-4 text-right">{formatCurrency(totals.actual, "USD")}</td>
              <td className="py-2 pr-4 text-right">
                {(() => {
                  const totalVariance = totals.actual - totals.budgeted;
                  const totalPercent =
                    totals.budgeted === 0 ? 0 : Math.round((totalVariance / totals.budgeted) * 100);
                  return (
                    <>
                      {totalVariance >= 0 ? "+" : ""}
                      {formatCurrency(totalVariance, "USD")} ({totalPercent >= 0 ? "+" : ""}
                      {totalPercent}%)
                    </>
                  );
                })()}
              </td>
              <td className="py-2" />
            </tr>
          </tfoot>
        )}
      </table>
      {budget.categories.length === 0 && (
        <p className="text-sm text-muted-foreground">No budget categories tracked yet.</p>
      )}
    </div>
  );
}
