import type { APIGatewayProxyEvent } from "aws-lambda";

export type CognitoClaims = {
  sub: string;
  email?: string;
};

export function getCognitoClaims(event: APIGatewayProxyEvent): CognitoClaims {
  const claims = event.requestContext.authorizer?.claims as
    | Record<string, string>
    | undefined;

  if (!claims?.sub) {
    throw new Error("Missing Cognito claims.");
  }

  return {
    sub: claims.sub,
    email: claims.email
  };
}