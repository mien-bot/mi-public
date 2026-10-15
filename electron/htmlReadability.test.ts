import { describe, expect, it } from "vitest";

const {
  absoluteUrl,
  decodeEntities,
  htmlToReadableText,
  plainText,
} = require("./htmlReadability");

describe("HTML entity decoding", () => {
  it("decodes named, decimal, and hexadecimal references and leaves unknown ones alone", () => {
    expect(decodeEntities("Small Business &amp; Improvement &mdash; up to &#36;150,000")).toBe(
      "Small Business & Improvement — up to $150,000",
    );
    expect(decodeEntities("&#x2014;&nbsp;fee")).toBe("— fee");
    expect(decodeEntities("&notarealentity; stays")).toBe("&notarealentity; stays");
  });
});

describe("URL absolutization", () => {
  it("resolves relative hrefs against the final URL and drops non-web schemes", () => {
    const base = "https://www.chicago.gov/city/en/depts/dcd.html";
    expect(absoluteUrl("/city/en/depts/dcd/sbif.html", base)).toBe("https://www.chicago.gov/city/en/depts/dcd/sbif.html");
    expect(absoluteUrl("sbif.pdf", base)).toBe("https://www.chicago.gov/city/en/depts/sbif.pdf");
    expect(absoluteUrl("mailto:someone@example.com", base)).toBeNull();
    expect(absoluteUrl("javascript:void(0)", base)).toBeNull();
    expect(absoluteUrl("", base)).toBeNull();
  });
});

describe("readable text extraction", () => {
  const page = `<!doctype html>
    <html><head>
      <title>SBIF Program</title>
      <style>.header { color: red }</style>
      <script>window.tracking = "should never appear";</script>
    </head>
    <body>
      <nav><a href="/other">Other programs</a></nav>
      <main>
        <h1>Small Business Improvement Fund</h1>
        <p>Grants cover up to <strong>&#36;150,000</strong> of eligible work.</p>
        <p>Read the <a href="/manual.pdf">program manual</a> before applying.</p>
        <ul><li>Applications open March 3</li><li>Deadline is April 30</li></ul>
        <p>${"Filler sentence to push this past the main-region threshold. ".repeat(12)}</p>
      </main>
      <footer><a href="/privacy">Privacy</a></footer>
    </body></html>`;

  it("returns the title, Markdown structure, and absolute links from the main region", () => {
    const result = htmlToReadableText(page, "https://www.chicago.gov/dcd/sbif.html");
    expect(result.title).toBe("SBIF Program");
    expect(result.text).toContain("# Small Business Improvement Fund");
    expect(result.text).toContain("Grants cover up to $150,000 of eligible work.");
    expect(result.text).toContain("- Applications open March 3");
    expect(result.text).toContain("[program manual](https://www.chicago.gov/manual.pdf)");
    expect(result.links).toContainEqual({ url: "https://www.chicago.gov/manual.pdf", text: "program manual" });
  });

  it("drops scripts, styles, and page chrome outside the main region", () => {
    const result = htmlToReadableText(page, "https://www.chicago.gov/dcd/sbif.html");
    expect(result.text).not.toContain("should never appear");
    expect(result.text).not.toContain("color: red");
    expect(result.text).not.toContain("Other programs");
    expect(result.text).not.toContain("Privacy");
  });

  it("falls back to the body, minus nav and footer, when no substantial main region exists", () => {
    const result = htmlToReadableText(
      `<html><body><nav>Menu</nav><main><p>Hi</p></main><div><h2>Notice</h2><p>Body copy.</p></div><footer>Legal</footer></body></html>`,
      "https://example.org/page",
    );
    expect(result.text).toContain("## Notice");
    expect(result.text).toContain("Body copy.");
    expect(result.text).not.toContain("Menu");
    expect(result.text).not.toContain("Legal");
  });

  it("reports a JavaScript shell as near-empty rather than inventing content", () => {
    const result = htmlToReadableText(
      `<html><head><title>App</title></head><body><div id="root"></div><script>boot();</script></body></html>`,
      "https://example.org/app",
    );
    expect(result.title).toBe("App");
    expect(result.text).toBe("");
    expect(result.links).toEqual([]);
  });

  it("collapses tag soup to a single readable line for titles and labels", () => {
    expect(plainText("<span>Deadline:</span>\n  <b>April&nbsp;30</b>")).toBe("Deadline: April 30");
  });
});
