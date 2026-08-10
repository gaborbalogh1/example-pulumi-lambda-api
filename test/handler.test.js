const test = require("node:test");
const assert = require("node:assert");
const { handler } = require("../lambda/index.js");

test("returns 200 with a JSON body containing the request path", async () => {
  const res = await handler({ rawPath: "/foo" });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers["content-type"], "application/json");

  const body = JSON.parse(res.body);
  assert.strictEqual(body.path, "/foo");
  assert.ok(typeof body.message === "string" && body.message.length > 0);
  assert.ok(!Number.isNaN(Date.parse(body.requestTime)));
});

test("falls back to '/' when no path is present on the event", async () => {
  const res = await handler({});
  const body = JSON.parse(res.body);
  assert.strictEqual(body.path, "/");
});

test("uses SERVICE_NAME/NODE_ENV from the environment in the message", async () => {
  process.env.SERVICE_NAME = "test-service";
  process.env.NODE_ENV = "test";
  try {
    const res = await handler({});
    const body = JSON.parse(res.body);
    assert.match(body.message, /test-service/);
    assert.match(body.message, /test/);
  } finally {
    delete process.env.SERVICE_NAME;
    delete process.env.NODE_ENV;
  }
});
