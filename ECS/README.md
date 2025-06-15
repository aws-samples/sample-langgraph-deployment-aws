# LangGraph AWS ECS Deployment

A production-ready solution for deploying LangGraph workflows as containerized applications on AWS ECS with a scalable, resilient architecture.

## Architecture Overview

This project implements a scalable, fault-tolerant architecture for deploying LangGraph workflows on AWS ECS with the following components:

- **FastAPI Application**: Serves the LangGraph workflow via REST API
- **Amazon ECS**: Container orchestration with Fargate for serverless container management
- **Amazon SQS**: Message queue for asynchronous processing and workload buffering
- **DynamoDB**: Persistent state storage for LangGraph workflows
- **Application Load Balancer**: Traffic distribution and health monitoring
- **API Gateway**: Clean API endpoints with additional security and monitoring
- **Auto Scaling**: Dynamic capacity management based on CPU and memory utilization
- **AWS Bedrock**: Access to Claude 3.5 Sonnet

## Project Structure

```
├── app/
│   ├── __init__.py
│   ├── main.py             # FastAPI application entry point
│   ├── workflow.py         # LangGraph workflow definition
│   ├── nodes.py            # Agent node definitions
│   ├── config.py           # Configuration settings
│   ├── models.py           # Pydantic models for request/response
│   └── prompts.py          # System prompts for LLM agents
├── Dockerfile              # Container definition
├── requirements.txt        # Python dependencies
└── infrastructure/         # AWS CDK infrastructure code
    ├── bin/
    │   └── app.ts          # CDK app entry point
    └── lib/
        └── langgraph-ecs-stack.ts  # Main infrastructure stack
```

## Workflow Description

This project implements a multi-step blog post generation workflow using LangGraph:

1. **Outline Generator**: Creates a structured outline for the blog post
2. **Human Feedback**: Optional step for human review and feedback on the outline
3. **Writer**: Drafts the blog content based on the approved outline
4. **Formatter**: Formats the final blog post in clean markdown

The workflow uses Claude 3.5 Sonnet via Amazon Bedrock for high-quality content generation and includes Tavily search integration for up-to-date information.

## Prerequisites

- Python 3.10+
- Node.js 14+ (for CDK)
- AWS CLI configured with appropriate permissions
- Docker installed locally
- AWS CDK installed globally (`npm install -g aws-cdk`)

## Local Development

1. Create a virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Create a `.env` file with your configuration:
   ```
   AWS_REGION=us-west-2
   DYNAMODB_TABLE=langgraph-state-local
   TAVILY_API_KEY=<your key>
   ```

4. Run the application locally:
   ```bash
   uvicorn app.main:app --reload
   ```

5. Access the API at http://localhost:8000

## Building and Testing the Docker Image

1. Build the Docker image:
   ```bash
   docker build -t langgraph-ecs:latest .
   ```

2. Run the container locally:
   ```bash
   docker run -p 8000:8000 --env-file .env langgraph-ecs:latest
   ```

## Deployment to AWS ECS

### Using AWS CDK

1. Navigate to the infrastructure directory:
   ```bash
   cd infrastructure
   ```

2. Install CDK dependencies:
   ```bash
   npm install
   ```

3. Bootstrap your AWS environment (if not already done):
   ```bash
   cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/us-west-2
   ```

4. Deploy the stack:
   ```bash
   cdk deploy
   ```


## API Usage

### Manual Workflow Trigger Endpoint

```
POST /trigger
```

Request body:
```json
{
  "thread_id": "optional-custom-id",
  "user_msg": "Write a technical blog post about AWS ECS and container orchestration"
}
```

Response:
```json
{
  "status": "processing",
  "thread_id": "generated-or-provided-id"
}
```

### Asynchronous Processing with SQS

```
POST /api/generate
```

Request body:
```json
{
  "thread_id": "optional-custom-id",
  "user_msg": "Write a technical blog post about AWS ECS and container orchestration"
}
```

Response:
```json
{
  "status": "processing",
  "thread_id": "generated-id",
  "message_id": "sqs-message-id"
}
```

### Check Workflow Status

```
GET /workflow/{thread_id}
```

Response:
```json
{
  "thread_id": "your-thread-id",
  "state": {
    "current_step": "writer",
    "outline": "...",
    "draft": "..."
  }
}
```

## API Examples

### Local Deployment

Generate content:
```bash
curl -X POST http://localhost:8000/api/generate \
  -H "Content-Type: application/json" \
  -d '{"user_msg": "Write a blog post about AWS ECS", "thread_id": "test-thread-123"}'
```

Check workflow status:
```bash
curl -X GET http://localhost:8000/workflow/test-thread-123
```

### Remote Deployment

Generate content:
```bash
curl -X POST https://your-api-gateway-url.execute-api.us-west-2.amazonaws.com/v0/api/generate \
  -H "Content-Type: application/json" \
  -d '{"user_msg": "Write a blog post about AWS ECS", "thread_id": "test-thread-456"}'
```

Check workflow status:
```bash
curl -X GET https://your-api-gateway-url.execute-api.us-west-2.amazonaws.com/v0/workflow/test-thread-456
```