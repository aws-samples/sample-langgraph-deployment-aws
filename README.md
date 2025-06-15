# LangGraph Deployment on AWS

This project demonstrates deployment architectures for LangGraph workflows on AWS using both serverless and containerized approaches.

## Project Overview

LangGraph is a framework for building stateful, multi-step AI agent workflows. This repository provides two complete implementation patterns for deploying LangGraph applications on AWS:

1. **Serverless Architecture** (Lambda-based)
   - Uses AWS Lambda, AppSync, SQS, and DynamoDB
   - Event-driven architecture with GraphQL API
   - Includes a React frontend for interaction

2. **Containerized Architecture** (ECS-based)
   - Uses Amazon ECS with Fargate, FastAPI, and Application Load Balancer
   - Scalable container deployment with auto-scaling
   - REST API endpoints for workflow interaction

Both implementations feature:
- Persistent state management
- Asynchronous processing
- Integration with Amazon Bedrock for LLM capabilities
- Production-ready infrastructure as code

## Repository Structure

```
.
├── lambda/                  # Serverless implementation
│   ├── appsync_resolvers/   # AppSync resolver Lambda functions
│   ├── orchestrator/        # LangGraph workflow orchestrator
│   ├── frontend/            # React frontend application
│   └── template.yaml        # SAM template for AWS resources
│
├── ECS/                     # Containerized implementation
│   ├── app/                 # FastAPI application with LangGraph workflow
│   ├── infrastructure/      # AWS CDK infrastructure code
│   └── Dockerfile           # Container definition
│
└── .aws-sam/               # SAM build artifacts
```

## Getting Started

Each implementation has its own README with detailed setup and deployment instructions:

- [Serverless Implementation Guide](./lambda/README.md)
- [Containerized Implementation Guide](./ECS/README.md)

## Prerequisites

- AWS Account with appropriate permissions
- AWS CLI configured with your credentials
- Python 3.10+
- Node.js (for frontend and CDK)
- Docker (for ECS deployment)
- AWS SAM CLI (for Lambda deployment)
- AWS CDK (for ECS deployment)
- Bedrock model access configured in your AWS account

## Features

- Multi-step AI agent workflows
- Persistent state management
- Asynchronous processing
- Real-time updates
- Scalable architecture
- Infrastructure as code
- Web interface for interaction
- Integration with Amazon Bedrock


## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.


## License

This project is licensed under the MIT License - see the LICENSE file for details.
