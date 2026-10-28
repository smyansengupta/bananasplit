import { PlusToggle } from "./plus-toggle";
import { CONTAINER, SectionTitle } from "./section-title";

export type FaqItem = { q: string; a: string };

/**
 * The title on the left, the questions on the right. Each question opens its
 * answer (a native <details>, so it works without JavaScript and with the
 * keyboard); they share a name, so opening one closes the one before.
 */
export function Faq({ items, title }: { items: readonly FaqItem[]; title: string }) {
  return (
    <section
      id="faq"
      className={`${CONTAINER} flex scroll-mt-20 flex-wrap gap-x-16 gap-y-8 pt-24 sm:pt-32`}
    >
      <div className="flex flex-[1_1_280px] flex-col gap-4">
        <SectionTitle className="text-balance">{title}</SectionTitle>
      </div>
      <div className="border-border flex min-w-0 flex-[2_1_560px] flex-col border-b">
        {items.map((faq) => (
          <details key={faq.q} name="faq" className="group border-border border-t">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[17px] leading-[1.4] font-semibold sm:py-6 [&::-webkit-details-marker]:hidden">
              {faq.q}
              <PlusToggle />
            </summary>
            <p className="text-muted-foreground max-w-[640px] pb-6 text-[16px] leading-[1.6] text-pretty sm:pe-14">
              {faq.a}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
