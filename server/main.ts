import { createServer } from "node:http";
import { handleApiRequest } from "./apiDispatch.js";

const port = Number.parseInt(process.env.PORT ?? "3001", 10);

const server = createServer((req, res) => {
  void handleApiRequest(req, res);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `Mock API listening on http://127.0.0.1:${port} (fixture mode only)\n`,
  );
});
