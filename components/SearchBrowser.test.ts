import { describe, expect, it } from "vitest";
import { SEARCH_TYPE_LABELS } from "./SearchBrowser";

describe("operational search labels", () => {
  it("provides clear labels for every new result type", () => {
    expect(SEARCH_TYPE_LABELS).toMatchObject({
      markup: "Markup",
      drawing: "Drawing",
      permit: "Permit",
      "qaqc-item": "QA/QC",
      submission: "Submission",
      contract: "Contract",
      inspiration: "Inspiration",
      "library-document": "Library Document",
    });
  });
});
