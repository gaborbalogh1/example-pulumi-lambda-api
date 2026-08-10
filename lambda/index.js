exports.handler = async (event) => {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: `Hello from ${process.env.SERVICE_NAME ?? "example-pulumi-lambda-api"} (${process.env.NODE_ENV ?? "dev"})`,
      path: event.rawPath ?? event.path ?? "/",
      requestTime: new Date().toISOString(),
    }),
  };
};
