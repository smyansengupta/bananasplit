import Link from "next/link";

/** Breadcrumb and title for an integration sub-page. */
export function IntegrationHeader({
  orgSlug,
  title,
  description,
}: {
  orgSlug: string;
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-1">
      <Link
        href={`/app/${orgSlug}/settings/integrations`}
        className="text-muted-foreground text-sm underline-offset-4 hover:underline"
      >
        ← Integrations
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
  );
}
