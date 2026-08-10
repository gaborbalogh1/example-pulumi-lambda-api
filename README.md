# example-pulumi-lambda-api

Forge blueprint — a real, deployable Lambda-behind-CloudFront stack in Pulumi TypeScript,
with an optional custom domain (ACM + Route53). This is the "Pulumi instead of Terraform"
example.

## What's actually here

- `lambda/index.js` — the real handler (returns a JSON response); unit-tested on its own in
  `test/handler.test.js`, independent of any AWS deploy.
- `index.ts` — IAM role, Lambda function (`FileArchive("./lambda")`, not an inline string),
  a public Function URL, and a CloudFront distribution in front of it. When `custom_domain`
  is set: an ACM cert in `us-east-1` (required for CloudFront), DNS validation, and an alias
  record — all in the hosted zone named by `hosted_zone_name`.
- `.github/workflows/deploy.yml` — `workflow_dispatch` running `pulumi up` against Pulumi
  Cloud, one stack per `service_name`-`environment`.

## Why `hosted_zone_name` is a separate, required input

Given a domain like `app.example.co.uk`, the hosted Route53 zone could be `example.co.uk`,
`co.uk`, or `app.example.co.uk` itself — there's no reliable way to derive which one from
the string alone (a naive "last two labels" split gets `gabaltech.co.uk` wrong, landing on
`co.uk`). So if you set `custom_domain`, you also set `hosted_zone_name` to the zone that
already exists in your account.

## Run locally

```bash
npm install
npm run build   # tsc --noEmit type-check
npm test        # unit tests for the Lambda handler, no AWS needed

pulumi stack init dev
IDP_SERVICE_NAME=demo IDP_ENVIRONMENT=dev pulumi up
```

Without a custom domain, `url` output is the CloudFront domain. With one:

```bash
IDP_SERVICE_NAME=demo IDP_ENVIRONMENT=dev \
IDP_CUSTOM_DOMAIN=demo.example.com IDP_HOSTED_ZONE_NAME=example.com \
pulumi up
```

## Deploy via CI

Trigger the `Deploy Lambda` workflow with `service_name`; everything else has a default
(`custom_domain`/`hosted_zone_name` empty = CloudFront's own domain). Requires
`PULUMI_ACCESS_TOKEN`/`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` repo secrets. The Pulumi
stack name is `<service_name>-<environment>` with no org prefix — `pulumi/actions` resolves
the org from whichever account `PULUMI_ACCESS_TOKEN` belongs to.
