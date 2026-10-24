/** What counts as clicking an icon: the control it sits in. */
const CONTROL =
  'a, button, summary, label, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"]';

/**
 * Plays the click animation (motion.css) of every icon inside `el`, from the
 * start even if it's mid-play, and clears the mark once they're done so a
 * later re-render doesn't replay them.
 */
export function playIconMotion(el: HTMLElement) {
  if (el.hasAttribute("data-icon-play")) {
    el.removeAttribute("data-icon-play");
    // Reading layout here lets the animation restart when the attribute returns.
    void el.offsetWidth;
  }
  el.setAttribute("data-icon-play", "");
  const done = () => {
    if (el.getAnimations({ subtree: true }).length > 0) return;
    el.removeAttribute("data-icon-play");
    el.removeEventListener("animationend", done);
  };
  el.addEventListener("animationend", done);
}

/**
 * Plays an icon's animation whenever the control it sits in is clicked,
 * anywhere on the page: one listener on the document, nothing per icon.
 * Returns the function that removes it.
 */
export function listenForIconClicks() {
  const onClick = (event: MouseEvent) => {
    const control = (event.target as Element | null)?.closest?.(CONTROL);
    if (control instanceof HTMLElement && control.querySelector(".bs-icon")) {
      playIconMotion(control);
    }
  };
  document.addEventListener("click", onClick, { capture: true, passive: true });
  return () => document.removeEventListener("click", onClick, { capture: true });
}
