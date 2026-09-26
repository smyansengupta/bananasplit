import { PublicThemeRoot } from "@/components/theme/public-theme-root";

/** Light/dark from the device (or the visitor's choice); see PublicThemeRoot. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <PublicThemeRoot>{children}</PublicThemeRoot>;
}
