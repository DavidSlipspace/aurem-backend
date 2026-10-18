import type {
  APIGatewayProxyResult
} from "aws-lambda";

export function jsonResponse(
  statusCode: number,
  body: unknown
): APIGatewayProxyResult {
  return {
    statusCode,

    headers: {
      "Content-Type":
        "application/json",

      "Access-Control-Allow-Origin":
        "https://app.orvotravel.com",

      "Access-Control-Allow-Headers":
        "Authorization,Content-Type",

      "Access-Control-Allow-Methods":
        "GET,POST,PUT,DELETE,OPTIONS"
    },

    body:
      JSON.stringify(
        body
      )
  };
}