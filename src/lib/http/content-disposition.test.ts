import { describe, expect, it } from "vitest";

import { contentDisposition } from "./content-disposition";

describe("contentDisposition (0A Fix 12)", () => {
  it("keeps a plain name readable", () => {
    expect(contentDisposition("inline", "receipt.pdf")).toBe(
      `inline; filename="receipt.pdf"; filename*=UTF-8''receipt.pdf`,
    );
  });

  it("cannot be broken out of with a quote or a backslash", () => {
    const value = contentDisposition("inline", 'evil".pdf"; x=\\y');
    const fallback = value.match(/filename="([^"]*)"/)?.[1];
    expect(fallback).toBe("evil_.pdf_; x=_y");
    expect(value.split('"').length).toBe(3); // exactly one quoted parameter
    expect(value).toContain("filename*=UTF-8''evil%22.pdf%22%3B%20x%3D%5Cy");
  });

  it("strips CR and LF, so no header can be injected", () => {
    const value = contentDisposition("attachment", "a.pdf\r\nSet-Cookie: session=stolen");
    expect(value).not.toMatch(/[\r\n]/);
    expect(value.startsWith("attachment; ")).toBe(true);
  });

  it("encodes non-ASCII names per RFC 5987 with an ASCII fallback", () => {
    const value = contentDisposition("inline", "reçu café (1).jpg");
    expect(value).toContain(`filename="re_u caf_ (1).jpg"`);
    expect(value).toContain("filename*=UTF-8''re%C3%A7u%20caf%C3%A9%20%281%29.jpg");
  });

  it("falls back to a generic name for an empty one", () => {
    expect(contentDisposition("inline", "   ")).toBe(
      `inline; filename="download"; filename*=UTF-8''download`,
    );
    expect(contentDisposition("inline", null)).toContain(`filename="download"`);
  });
});
