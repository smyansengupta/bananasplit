import type { FormEvent } from "react";

/**
 * Instead of the browser's "Please fill out this field" bubble: on submit,
 * any field that fails its own rules (required, type="email", minLength)
 * is marked aria-invalid, so it's outlined in red (brandInputClass), and
 * the first is focused; the form doesn't submit. Typing in a field clears
 * its mark (clearInvalid). Use with `noValidate` on the form.
 */
export function highlightInvalid(event: FormEvent<HTMLFormElement>): boolean {
  const fields = Array.from(event.currentTarget.elements).filter(
    (el): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
      (el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement) &&
      el.willValidate &&
      !el.checkValidity(),
  );
  if (fields.length === 0) return false;
  event.preventDefault();
  for (const field of fields) field.setAttribute("aria-invalid", "true");
  fields[0]!.focus();
  return true;
}

/** The form's onInput: a field being typed in is no longer marked. */
export function clearInvalid(event: FormEvent<HTMLFormElement>): void {
  const target = event.target as HTMLElement;
  if (target.getAttribute("aria-invalid") === "true") target.removeAttribute("aria-invalid");
}
