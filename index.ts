import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const serviceName = process.env.IDP_SERVICE_NAME ?? pulumi.getStack();
const environment = process.env.IDP_ENVIRONMENT ?? "dev";
const memorySize = Number(process.env.IDP_MEMORY_SIZE ?? "256");
const timeoutSeconds = Number(process.env.IDP_TIMEOUT ?? "30");
const customDomain = process.env.IDP_CUSTOM_DOMAIN?.trim() || undefined;
const hostedZoneName = process.env.IDP_HOSTED_ZONE_NAME?.trim() || undefined;

if (customDomain && !hostedZoneName) {
  throw new Error(
    "IDP_CUSTOM_DOMAIN is set but IDP_HOSTED_ZONE_NAME is not. The parent " +
      "hosted zone can't be reliably guessed from the domain string alone " +
      "(e.g. gabaltech.co.uk's zone is 'gabaltech.co.uk', not the 'co.uk' " +
      "a naive last-two-labels split would produce) -- pass it explicitly.",
  );
}

const name = `${serviceName}-${environment}`;
const tags = { project: serviceName, environment, managedBy: "pulumi" };

// ---------------------------------------------------------------------------
// Lambda
// ---------------------------------------------------------------------------

const lambdaRole = new aws.iam.Role(`${name}-role`, {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Action: "sts:AssumeRole",
        Effect: "Allow",
        Principal: { Service: "lambda.amazonaws.com" },
      },
    ],
  }),
  tags,
});

new aws.iam.RolePolicyAttachment(`${name}-logs-policy`, {
  role: lambdaRole.name,
  policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
});

// A real, working handler in ./lambda, not a placeholder -- `pulumi up` on
// this example produces something you can actually curl. It's a real file
// (not an inline string) so it can be linted and unit-tested on its own --
// see test/handler.test.js.
const lambdaFunction = new aws.lambda.Function(`${name}-fn`, {
  runtime: aws.lambda.Runtime.NodeJS22dX,
  role: lambdaRole.arn,
  handler: "index.handler",
  memorySize,
  timeout: timeoutSeconds,
  code: new pulumi.asset.FileArchive("./lambda"),
  environment: {
    variables: {
      SERVICE_NAME: serviceName,
      NODE_ENV: environment === "prod" ? "production" : environment,
    },
  },
  tags,
});

const functionUrl = new aws.lambda.FunctionUrl(`${name}-url`, {
  functionName: lambdaFunction.name,
  authorizationType: "NONE",
});

new aws.lambda.Permission(`${name}-url-invoke`, {
  action: "lambda:InvokeFunctionUrl",
  function: lambdaFunction.name,
  principal: "*",
  functionUrlAuthType: "NONE",
});

const functionUrlDomain = functionUrl.functionUrl.apply((url) => new URL(url).hostname);

// ---------------------------------------------------------------------------
// Optional custom domain: ACM cert (must be in us-east-1 for CloudFront) +
// Route53 DNS validation + alias record, in the hosted zone named by
// `hostedZoneName` -- if that zone doesn't exist in this account,
// `getZoneOutput` fails loudly at preview/up time rather than silently
// deploying without a working domain.
// ---------------------------------------------------------------------------

const usEast1 = new aws.Provider(`${name}-us-east-1`, { region: "us-east-1" });

let aliases: string[] | undefined;
let viewerCertificate: aws.types.input.cloudfront.DistributionViewerCertificate = {
  cloudfrontDefaultCertificate: true,
};
let hostedZoneId: pulumi.Output<string> | undefined;

if (customDomain && hostedZoneName) {
  const zone = aws.route53.getZoneOutput({ name: hostedZoneName, privateZone: false });
  hostedZoneId = zone.zoneId;

  const cert = new aws.acm.Certificate(
    `${name}-cert`,
    {
      domainName: customDomain,
      validationMethod: "DNS",
      tags,
    },
    { provider: usEast1 },
  );

  const validationRecord = new aws.route53.Record(`${name}-cert-validation`, {
    zoneId: zone.zoneId,
    name: cert.domainValidationOptions.apply((opts) => opts[0].resourceRecordName),
    type: cert.domainValidationOptions.apply((opts) => opts[0].resourceRecordType),
    records: [cert.domainValidationOptions.apply((opts) => opts[0].resourceRecordValue)],
    ttl: 60,
  });

  const certValidation = new aws.acm.CertificateValidation(
    `${name}-cert-validated`,
    {
      certificateArn: cert.arn,
      validationRecordFqdns: [validationRecord.fqdn],
    },
    { provider: usEast1 },
  );

  aliases = [customDomain];
  viewerCertificate = {
    acmCertificateArn: certValidation.certificateArn,
    sslSupportMethod: "sni-only",
    minimumProtocolVersion: "TLSv1.2_2021",
  };
}

// ---------------------------------------------------------------------------
// CloudFront -- AWS-managed CachingDisabled + AllViewerExceptHostHeader
// policies, since the origin is an API, not static assets.
// ---------------------------------------------------------------------------

const cachingDisabledPolicyId = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad";
const allViewerExceptHostHeaderPolicyId = "b689b0a8-53d0-40ab-baf2-68738e2966ac";

const distribution = new aws.cloudfront.Distribution(`${name}-cdn`, {
  enabled: true,
  aliases,
  origins: [
    {
      originId: "lambda",
      domainName: functionUrlDomain,
      customOriginConfig: {
        httpPort: 80,
        httpsPort: 443,
        originProtocolPolicy: "https-only",
        originSslProtocols: ["TLSv1.2"],
      },
    },
  ],
  defaultCacheBehavior: {
    targetOriginId: "lambda",
    viewerProtocolPolicy: "redirect-to-https",
    allowedMethods: ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"],
    cachedMethods: ["GET", "HEAD"],
    cachePolicyId: cachingDisabledPolicyId,
    originRequestPolicyId: allViewerExceptHostHeaderPolicyId,
  },
  restrictions: {
    geoRestriction: { restrictionType: "none" },
  },
  viewerCertificate,
  tags,
});

if (customDomain && hostedZoneId) {
  new aws.route53.Record(`${name}-alias`, {
    zoneId: hostedZoneId,
    name: customDomain,
    type: "A",
    aliases: [
      {
        name: distribution.domainName,
        zoneId: distribution.hostedZoneId,
        evaluateTargetHealth: false,
      },
    ],
  });
}

export const functionName = lambdaFunction.name;
export const cloudfrontDomainName = distribution.domainName;
export const url = pulumi.output(customDomain ?? distribution.domainName).apply((d) => `https://${d}`);
