import type { APIGatewayProxyResult } from "aws-lambda";

export function jsonResponse(
  statusCode: number,
  body: unknown
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin":
        "http://localhost:5173",
      "Access-Control-Allow-Headers":
        "Authorization,Content-Type",
      "Access-Control-Allow-Methods":
        "GET,POST,PUT,OPTIONS"
    },
    body: JSON.stringify(body)
  };
}