import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-app-bg text-app-text flex flex-col items-center justify-center p-8">
      <h1 className="text-2xl font-semibold mb-2">Flent pipeline</h1>
      <p className="text-app-muted mb-6 text-center max-w-md">
        Sales dashboard backed by Google Sheets. Connect credentials in{" "}
        <code className="text-slate-800 dark:text-zinc-300">.env.local</code> then open the pipeline.
      </p>
      <Link
        href="/pipeline"
        className="rounded-lg bg-flentGreen px-5 py-2.5 text-sm font-medium text-zinc-950 hover:bg-flentGreen/90"
      >
        Open pipeline
      </Link>
    </div>
  );
}
