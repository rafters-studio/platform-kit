import { expect, test } from "vite-plus/test";
import * as client from "../src/client/index.ts";
import * as server from "../src/server/index.ts";
import * as shared from "../src/shared/index.ts";

test("the shared, server, and client subpaths each import", () => {
  expect(shared).toBeTypeOf("object");
  expect(server).toBeTypeOf("object");
  expect(client).toBeTypeOf("object");
});
