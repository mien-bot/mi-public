import { describe, expect, it } from "vitest";
import { projectDetailsSchema } from "@/lib/schema";

describe("project details schema", () => {
  it("accepts confirmed commercial details without placeholders", () => {
    expect(projectDetailsSchema.parse({ fee: 25000, client_name: "Client" })).toMatchObject({
      fee: 25000,
      fee_currency: "USD",
      client_name: "Client",
    });
  });

  it("rejects invalid fee and contact email values", () => {
    expect(() => projectDetailsSchema.parse({ fee: -1 })).toThrow();
    expect(() => projectDetailsSchema.parse({ client_contacts: [{ email: "not-an-email" }] })).toThrow();
  });
});
