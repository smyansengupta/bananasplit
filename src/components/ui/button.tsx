import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";

/*
 * Buttons (Moonstone): pills in two sizes, 40 (default) and 32 (sm). `xs`
 * and `lg` are kept as aliases of sm and default so older call sites line
 * up. `create` is a plain solid button in the theme's blank colour (--create,
 * derive.ts) with a hairline edge and no shadow, for the one "New ..." action
 * on a screen; `default` (primary) commits. `destructive` is the one
 * red button, in forms and confirm dialogs alike. Circle icon buttons are
 * `size="icon"` / `"icon-sm"` with `variant="outline"`; `icon-xs` is only
 * for controls inside a field (clear, remove).
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-full border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-150 ease-(--ease-ink) outline-none select-none active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground focus-visible:shadow-[0_0_0_4px_color-mix(in_oklab,var(--glow)_45%,transparent)] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-hover",
        create:
          "border-input bg-create text-create-foreground hover:bg-[color-mix(in_oklab,var(--create)_92%,var(--create-foreground))] focus-visible:shadow-none aria-expanded:bg-[color-mix(in_oklab,var(--create)_92%,var(--create-foreground))]",
        outline:
          "border-input bg-transparent hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-muted-strong aria-expanded:bg-muted-strong",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        destructive:
          "bg-block-alert text-block-alert-foreground hover:bg-[color-mix(in_oklab,var(--block-alert)_88%,black)] focus-visible:shadow-[0_0_0_4px_color-mix(in_oklab,var(--block-alert)_35%,transparent)]",
        link: "rounded-none text-primary underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        default:
          "h-10 gap-2 px-[1.125rem] has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        xs: "h-8 gap-1.5 px-3.5 text-[0.8125rem] has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        sm: "h-8 gap-1.5 px-3.5 text-[0.8125rem] has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        lg: "h-10 gap-2 px-[1.125rem] has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        icon: "size-10 active:scale-[0.94]",
        "icon-xs": "size-6 active:scale-[0.94] [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-8 active:scale-[0.94]",
        "icon-lg": "size-10 active:scale-[0.94]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
