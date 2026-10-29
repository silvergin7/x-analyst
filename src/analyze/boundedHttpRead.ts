export class BoundedBodyTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoundedBodyTooLargeError";
  }
}

export async function readResponseBodyWithCap(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && contentLength !== "") {
    const length = Number(contentLength);
    if (Number.isFinite(length) && length > maxBytes) {
      throw new BoundedBodyTooLargeError("Response Content-Length exceeds the size cap");
    }
  }
  if (response.body === null) {
    return Buffer.alloc(0);
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      throw new BoundedBodyTooLargeError("Response body exceeded the size cap");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
