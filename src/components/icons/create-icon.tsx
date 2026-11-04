import type { ComponentProps, FC, ReactNode } from "react";

/*
 * Bananasplit's own icons ("Split"): drawn on a 24-unit grid in a 2-unit
 * round-capped stroke of the current text colour, so an icon takes the
 * colour and size of the text around it. The drawing rules are in
 * src/components/icons/README.md.
 *
 * No hooks and no context, so an icon renders in a server component without
 * a client boundary. Each icon is its own module (./glyphs), so a page's
 * JavaScript carries only the icons it uses.
 */

export type IconProps = ComponentProps<"svg"> & {
  /** Width and height, in pixels or any CSS length. A size-* class overrides it. */
  size?: number | string;
  strokeWidth?: number | string;
  /** Keep the stroke the same width in pixels at any size. */
  absoluteStrokeWidth?: boolean;
};

export type IconComponent = FC<IconProps>;

/** Props that name the icon to assistive tech; without one it's hidden from it. */
function isLabelled(props: Record<string, unknown>) {
  return Object.keys(props).some((k) => k.startsWith("aria-") || k === "role" || k === "title");
}

/**
 * An icon component from its drawing. `glyph` is the SVG's children on the
 * 24-unit grid; a filled detail (a seed) sets fill="currentColor"
 * stroke="none" itself. `motion` names the whole icon's click animation
 * (motion.css); a part that moves on its own carries data-m itself.
 */
export function createIcon(name: string, glyph: ReactNode, motion?: string): IconComponent {
  const slug = name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

  function Icon({
    size = 24,
    color = "currentColor",
    strokeWidth = 2,
    absoluteStrokeWidth = false,
    className,
    children,
    ...rest
  }: IconProps) {
    const stroke = absoluteStrokeWidth
      ? (Number(strokeWidth) * 24) / Number.parseFloat(String(size))
      : strokeWidth;
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        color={color === "currentColor" ? undefined : color}
        className={className ? `bs-icon bs-icon-${slug} ${className}` : `bs-icon bs-icon-${slug}`}
        data-m={motion}
        aria-hidden={children != null || isLabelled(rest) ? undefined : true}
        {...rest}
      >
        {glyph}
        {children}
      </svg>
    );
  }

  Icon.displayName = name;
  return Icon;
}
