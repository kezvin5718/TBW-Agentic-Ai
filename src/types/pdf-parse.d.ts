// Type shim for importing pdf-parse's internal entry point directly, which avoids
// the package's debug harness (its index.js reads a bundled test PDF when it thinks
// it is the main module — that breaks under Next.js bundling).
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    info: Record<string, unknown>;
    metadata: unknown;
    version: string;
  }
  const pdf: (dataBuffer: Buffer) => Promise<PdfParseResult>;
  export default pdf;
}
