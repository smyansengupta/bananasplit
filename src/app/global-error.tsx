"use client";

/* eslint-disable theme/no-raw-colors, @next/next/no-html-link-for-pages -- the root layout failed: no theme tokens, stylesheet or router to lean on, so plain colours and a full-page link. */

/**
 * The last resort: the root layout itself failed, so nothing of the app's
 * (fonts, theme, components) can be counted on. Plain HTML, the same two
 * ways on as every other error page.
 */
export default function GlobalError({ retry }: { error: Error; retry: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "grid",
          placeItems: "center",
          minHeight: "100dvh",
          margin: 0,
          background: "#fff",
          color: "#0a0a0a",
        }}
      >
        <main style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 28, margin: "0 0 20px" }}>Bananasplit didn&apos;t load.</h1>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => retry()}
              style={{
                height: 44,
                padding: "0 22px",
                borderRadius: 999,
                border: 0,
                background: "#171717",
                color: "#fff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                height: 44,
                padding: "0 22px",
                borderRadius: 999,
                border: "1px solid #d4d4d4",
                color: "#0a0a0a",
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                textDecoration: "none",
              }}
            >
              Home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
