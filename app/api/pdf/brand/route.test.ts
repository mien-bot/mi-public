import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { POST } from "./route";

function request(bytes: Uint8Array, headers = {}) {
  return new Request("http://127.0.0.1:3051/api/pdf/brand", {
    method: "POST", headers: { "Content-Type": "application/pdf", ...headers }, body: new Uint8Array(bytes),
  });
}

describe("standalone Mi PDF branding", () => {
  it("brands a standalone PDF without a Notion task and is byte-stable on retry", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const response = await POST(request(await pdf.save()));
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Mi-Branding")).toBe("applied");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const retry = await POST(request(bytes));
    expect(retry.headers.get("X-Mi-Branding")).toBe("already-branded");
    expect(new Uint8Array(await retry.arrayBuffer())).toEqual(bytes);
  });

  it("refuses malformed or partially stampable output instead of exporting an unmarked file", async () => {
    expect((await POST(request(Buffer.from("not a pdf")))).status).toBe(422);
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.addPage([50, 50]);
    expect((await POST(request(await pdf.save()))).status).toBe(422);
  });

  it("enforces content type and declared size before parsing", async () => {
    expect((await POST(request(new Uint8Array(), { "Content-Type": "text/plain" }))).status).toBe(415);
    expect((await POST(request(new Uint8Array(), { "Content-Length": String(21 * 1024 * 1024) }))).status).toBe(413);
  });
});
