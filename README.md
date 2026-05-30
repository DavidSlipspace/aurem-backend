# Slipspace Backend

Backend service for the Slipspace application.

This repository contains the AWS SAM-based backend infrastructure and serverless application code for Slipspace.

## Current Purpose

The current backend scope is focused on establishing the initial application foundation:

* AWS SAM deployment structure
* Lambda-based backend functions
* PostgreSQL database setup support
* Initial authentication and user-role groundwork

## Technology Stack

* AWS SAM
* AWS Lambda
* Node.js
* TypeScript
* PostgreSQL
* API Gateway

## Local Prerequisites

Before running this project locally, install:

* Node.js
* npm
* AWS CLI
* AWS SAM CLI
* Git

Verify installations:

```bash
node --version
npm --version
aws --version
sam --version
```

## Install Dependencies

```bash
npm install
```

## Type Check

```bash
npm run typecheck
```

## Build

```bash
sam build
```

## Deploy

```bash
sam deploy --guided
```

## Current Deployment Notes

The current SAM deployment is intended for the development environment only.

Planned environment naming convention:

```text
slipspace-dev
slipspace-staging
slipspace-prod
```

## Database Scope

The first database scope is limited to the minimum tables required for Week 3 authentication and role functionality:

* users
* roles
* user_roles

Additional tables should only be added as required by upcoming functional milestones.

## Branching Strategy

```text
main
  stable baseline

dev
  active integration branch

feature/*
  individual feature work
```

Example:

```text
feature/db-setup
feature/auth-login
feature/user-role-display
```

## Security Notes

Do not commit:

* `.env` files
* database passwords
* AWS credentials
* deployment secrets
* `samconfig.toml` if it contains sensitive parameter values

All sensitive values should eventually be moved into AWS Secrets Manager or another approved secret management system.

## Project Status

Early development foundation phase.
