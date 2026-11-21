import { canWrite, getReviewer, passcodeRequired, reviewerLabel } from "@/lib/auth";
import { getDashboard } from "@/lib/cases";
import { ReviewApp } from "@/components/review/review-app";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [canAct, reviewer] = await Promise.all([canWrite(), getReviewer()]);
  let data;
  try {
    data = await getDashboard();
  } catch (e) {
    return <SetupError message={e instanceof Error ? e.message : String(e)} />;
  }
  const required = passcodeRequired();
  return (
    <ReviewApp
      data={data}
      canAct={canAct}
      passcodeRequired={required}
      reviewer={reviewer ? { ...reviewer, label: reviewerLabel(reviewer) } : null}
      // CRM-browser links embed the token server-side; only offer them to people who could act anyway.
      crmLinks={!required || canAct}
    />
  );
}

function SetupError({ message }: { message: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-xl font-semibold">Can&apos;t reach the review store</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      <p className="text-xs text-muted-foreground">
        Set <code>DATABASE_URL</code> and <code>CRM_API_TOKEN</code>, or run with <code>DATA_SOURCE=mock</code> to try the app on the real snapshot with a fake CRM.
      </p>
    </main>
  );
}
