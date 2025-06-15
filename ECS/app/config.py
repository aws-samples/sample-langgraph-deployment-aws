import os

# AWS Configuration
DEFAULT_REGION = os.environ.get("AWS_REGION", "us-west-2")
DYNAMODB_TABLE = os.environ.get("DYNAMODB_TABLE", "langgraph-state")
SQS_QUEUE_URL = os.environ.get("SQS_QUEUE_URL", "...")
SQS_DLQ_URL = os.environ.get("SQS_DLQ_URL", "...")

# Model Configuration
MODEL_ID = os.environ.get("MODEL_ID", "anthropic.claude-3-5-sonnet-20241022-v2:0")

# Application Configuration
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")