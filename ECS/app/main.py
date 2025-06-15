import asyncio
import json
import os
import logging
from typing import Dict, Any, Optional
import uuid
from pydantic import BaseModel

import boto3
from botocore.exceptions import ClientError
from fastapi import FastAPI, BackgroundTasks, HTTPException
import uvicorn
from app.workflow import Workflow
from datetime import datetime
from app.config import DEFAULT_REGION, SQS_QUEUE_URL, SQS_DLQ_URL
from fastapi.middleware.cors import CORSMiddleware

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(title="LangGraph API Service")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Workflow class
workflow = Workflow()

# Initialize SQS client
sqs_client = boto3.client("sqs", region_name=DEFAULT_REGION)

# Global control flags for background tasks
is_polling = False
polling_tasks = []

# Define request models for API validation
class GenerationRequest(BaseModel):
    user_msg: str
    thread_id: Optional[str] = None  # Make thread_id optional

# Add these endpoints to the existing FastAPI app

@app.post("/api/generate")
async def generate_content(request: GenerationRequest):
    """API Gateway entry point for content generation requests."""
    try:
        # Create a unique ID for this request
        if request.thread_id:
            thread_id = request.thread_id
        else:
            thread_id = str(uuid.uuid4())

        # Prepare the message for SQS
        message = {
            "thread_id": thread_id,
            "user_msg": request.user_msg,
            "timestamp": datetime.utcnow().isoformat(),
        }

        # Send the message to SQS
        await asyncio.to_thread(
            sqs_client.send_message, QueueUrl=SQS_QUEUE_URL, MessageBody=json.dumps(message)
        )

        logger.info(f"Created SQS message with thread_id: {thread_id}")

        # Return response with tracking information
        return {
            "status": "processing",
            "thread_id": thread_id
        }

    except ClientError as e:
        logger.error(f"Error sending message to SQS: {e}")
        raise HTTPException(status_code=500, detail="Failed to queue your request")

async def process_message(message: Dict[Any, Any]) -> None:
    """Process a single SQS message through the LangGraph workflow."""
    try:
        # Extract message body and parse JSON
        message_body = json.loads(message["Body"])

        # Get thread_id from message or generate a new one
        thread_id = message_body.get("thread_id", str(uuid.uuid4()))
        user_msg = message_body.get("user_msg", "")

        logger.info(f"Processing message for thread_id: {thread_id}")

        # Limit concurrent workflow executions
        result = await workflow.run_workflow(thread_id, user_msg)

        logger.info(f"Workflow result for thread_id {thread_id}: {result}")

        # Delete the processed message from the queue
        receipt_handle = message["ReceiptHandle"]
        await asyncio.to_thread(
            sqs_client.delete_message, QueueUrl=SQS_QUEUE_URL, ReceiptHandle=receipt_handle
        )

    except Exception as e:
        logger.error(f"Error processing message: {e}", exc_info=True)

        # Move message to dead letter queue if available
        if SQS_DLQ_URL:
            try:
                error_message = {
                    "original_message": message.get("Body", ""),
                    "error": str(e)
                }
                sqs_client.send_message(
                    QueueUrl=SQS_DLQ_URL,
                    MessageBody=json.dumps(error_message)
                )

                # Delete from original queue
                receipt_handle = message["ReceiptHandle"]
                await asyncio.to_thread(
                    sqs_client.delete_message, QueueUrl=SQS_QUEUE_URL, ReceiptHandle=receipt_handle
                )

            except ClientError as ce:
                logger.error(f"Error sending to dead letter queue: {ce}")


async def poll_sqs_queue() -> None:
    """Continuously poll the SQS queue for messages."""
    global is_polling
    logger.info(f'POLLING: {is_polling}')
    logger.info(f"Starting SQS polling with queue URL: {SQS_QUEUE_URL}")

    while is_polling:
        try:
            # Log before receiving messages
            logger.info("Attempting to receive messages from SQS")

            # Receive messages from SQS
            response = await asyncio.to_thread(
                sqs_client.receive_message,
                QueueUrl=SQS_QUEUE_URL,
                MaxNumberOfMessages=10,
                WaitTimeSeconds=2,
            )

            # Log the raw response for debugging
            logger.info(f"SQS receive_message response: {response}")

            messages = response.get("Messages", [])

            if messages:
                logger.info(f"Received {len(messages)} messages")

                # Log message IDs for tracking
                message_ids = [msg.get("MessageId", "unknown") for msg in messages]
                logger.info(f"Message IDs: {message_ids}")

                # Process messages concurrently
                await asyncio.gather(*[process_message(message) for message in messages])
            else:
                logger.info("No messages received from SQS")

            # Short sleep to prevent tight polling loop
            await asyncio.sleep(0.5)

        except Exception as e:
            logger.error(f"Error polling SQS: {e}", exc_info=True)
            await asyncio.sleep(5)  # Backoff on error

@app.on_event("startup")
async def startup_event():
    """Start the SQS polling on application startup."""
    global is_polling, polling_tasks

    if not SQS_QUEUE_URL:
        logger.warning("SQS_QUEUE_URL environment variable not set. SQS polling disabled.")
        return

    is_polling = True
    # Start a polling task
    task = asyncio.create_task(poll_sqs_queue())
    polling_tasks.append(task)
    logger.info("Started SQS polling task")

@app.on_event("shutdown")
async def shutdown_event():
    """Stop the SQS polling on application shutdown."""
    global is_polling, polling_tasks

    logger.info("Shutting down SQS polling")
    if polling_tasks:
        is_polling = False
        for task in polling_tasks:
            task.cancel()

        await asyncio.gather(*polling_tasks, return_exceptions=True)
        logger.info("All SQS polling tasks cancelled")

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "sqs_polling_active": is_polling,
        "polling_tasks": len([t for t in polling_tasks if not t.done()])
    }

@app.post("/trigger")
async def trigger_workflow(data: Dict[str, Any], background_tasks: BackgroundTasks):
    """Manually trigger a workflow run."""
    try:
        thread_id = data.get("thread_id", str(uuid.uuid4()))
        user_msg = data.get("user_msg", "")

        # Run workflow asynchronously
        background_tasks.add_task(workflow.run_workflow, thread_id, user_msg)

        return {
            "status": "processing",
            "thread_id": thread_id
        }
    except Exception as e:
        logger.error(f"Error triggering workflow: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/workflow/{thread_id}")
async def get_workflow_state(thread_id: str):
    """Get the current state of a workflow."""
    try:
        state = workflow.get_current_state(thread_id)
        return {"thread_id": thread_id, "state": state}
    except Exception as e:
        logger.error(f"Error getting workflow state: {e}")
        raise HTTPException(status_code=404, detail=f"Workflow with ID {thread_id} not found")

if __name__ == "__main__":
    # Run the FastAPI application with uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port="8000")