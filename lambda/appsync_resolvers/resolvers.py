import json
import os
import boto3
import logging

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
sqs = boto3.client("sqs")

# Get environment variables
queue_url = os.environ.get("QUEUE_URL")


def handler(event, context):
    """
    Lambda handler for AppSync resolvers
    """
    logger.info(f"Received event: {json.dumps(event)}")

    field = event.get("field")
    arguments = event.get("arguments", {})

    if field == "sendMessage":
        return send_message(arguments.get("workflowId"), arguments.get("message"))

    elif field == "publishWorkflowResult":
        return publish_workflow_result(
            arguments.get("workflowId"), arguments.get("result")
        )
    else:
        raise Exception(f"Unknown field: {field}")


def send_message(workflow_id, message):
    """
    Send a message for an existing workflow
    """
    if not workflow_id or not message:
        raise Exception("Workflow ID and message are required")

    # Send a message to SQS to process the message
    sqs.send_message(
        QueueUrl=queue_url,
        MessageBody=json.dumps({"workflow_id": workflow_id, "message": message}),
    )

    logger.info(f"Sent message for workflow {workflow_id}: {message}")

    return {"workflowId": workflow_id, "status": "PROCESSING"}



def publish_workflow_result(workflow_id, result):
    """
    Publish a workflow result (called by the orchestrator)
    """

    # Return the result (will be published to subscriptions by AppSync)
    return {"workflowId": workflow_id, "result": result}
