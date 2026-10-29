import { BrandRoot } from "@/components/brand/brand-root";

/** Bananasplit's own look: Graphite with Geist headlines, as on the home page (BrandRoot). */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <BrandRoot>{children}</BrandRoot>;
}
