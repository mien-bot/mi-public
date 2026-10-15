import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ErrorPage from "./error";

describe("root error recovery", () => {
  it("offers recovery without displaying raw error details", () => {
    const markup = renderToStaticMarkup(
      <ErrorPage error={new Error("C:\\private\\credential.txt")} unstable_retry={vi.fn()} />,
    );
    expect(markup).toContain("Try again");
    expect(markup).toContain("Return to Mi");
    expect(markup).not.toContain("credential.txt");
  });
});
