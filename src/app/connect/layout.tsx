import { BrandRoot } from "@/components/brand/brand-root";

/** Bananasplit's own look: Moonstone, dark by default (BrandRoot). */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <BrandRoot>{children}</BrandRoot>;
}
