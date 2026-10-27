import { get } from "node:http";

/** Native fetch forces CORS metadata; model an actual browser navigation instead. */
export function navigate(url: string | URL, headers: Record<string, string> = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    get(url, { headers: { ...headers, accept: "text/html", "sec-fetch-mode": "navigate" } }, response => {
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => {
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(response.headers)) {
          for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) responseHeaders.append(key, item);
        }
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: responseHeaders }));
      });
    }).on("error", reject);
  });
}
