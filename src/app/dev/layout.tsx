import { notFound } from "next/navigation";

import { PublicThemeRoot } from "@/components/theme/public-theme-root";

/**
 * /dev/* is a component gallery for local development only (0A Fix 13): it
 * renders nothing in a production build.
 */
export default function DevLayout({ children }: LayoutProps<"/dev">) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return <PublicThemeRoot>{children}</PublicThemeRoot>;
}
