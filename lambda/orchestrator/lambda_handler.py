import json
import os
import sys


import boto3
import logging
import asyncio
import requests

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)


from workflow import Workflow

logger.setLevel(logging.INFO)

# Initialize AWS clients
sqs = boto3.client("sqs")

# Get environment variables
appsync_endpoint = os.environ.get("APPSYNC_ENDPOINT")
appsync_api_key = os.environ.get("APPSYNC_API_KEY")
region = os.environ.get("REGION", "us-west-2")


def handler(event, context):
    """
    Lambda handler for processing SQS messages containing workflow requests
    """
    logger.info(f"Received event: {json.dumps(event)}")

    # Process SQS messages
    for record in event.get("Records", []):
        try:
            # Parse the message body
            message_body = json.loads(record["body"])
            workflow_id = message_body.get("workflow_id")
            user_message = message_body.get("message")

            logger.info(
                f"Processing workflow {workflow_id} with message: {user_message}"
            )

            # Initialize the workflow
            workflow = Workflow()

            # Process the workflow with the user message
            result = asyncio.run(process_workflow(workflow, workflow_id, user_message))
            
            publish_workflow_result(workflow_id, result)

            logger.info(f"Successfully processed workflow {workflow_id}")

        except Exception as e:
            logger.error(f"Error processing message: {str(e)}")
            # Don't re-raise the exception to avoid retrying the message
            # It will be retried automatically by SQS if needed


async def process_workflow(workflow, workflow_id, user_message):
    """
    Process a workflow with user message (either initial input or feedback)
    """
    result = await workflow.invoke_graph(user_message, workflow_id)

    return result



def publish_workflow_result(workflow_id, result):
    """
    Publish the workflow result directly to AppSync subscriptions
    """
    # Prepare the mutation for publishing the result
    mutation = """
    mutation PublishWorkflowResult($workflowId: ID!, $result: String!) {
      publishWorkflowResult(
        workflowId: $workflowId, 
        result: $result
      ) {
        workflowId
        result
      }
    }
    """

    variables = {"workflowId": workflow_id, "result": result}

    # Execute the mutation
    execute_appsync_graphql(mutation, variables)

    logger.info(f"Published result for workflow {workflow_id}")


def execute_appsync_graphql(query, variables):
    """
    Execute a GraphQL query/mutation against AppSync
    """
    try:
        headers = {"Content-Type": "application/json", "x-api-key": appsync_api_key}

        body = {"query": query, "variables": variables}

        # Log the exact request being sent for debugging
        logger.info(f"Sending GraphQL request to AppSync:")
        logger.info(f"Query: {query}")
        logger.info(f"Variables: {json.dumps(variables)}")
        logger.info(f"Full request body: {json.dumps(body)}")

        response = requests.post(appsync_endpoint, headers=headers, json=body)

        # Log the response for debugging
        logger.info(f"AppSync response status: {response.status_code}")
        logger.info(f"AppSync response body: {response.text}")

        if response.status_code != 200:
            logger.error(
                f"AppSync request failed with status {response.status_code}: {response.text}"
            )
            return None

        result = response.json()

        # Check for errors in the GraphQL response
        if "errors" in result:
            logger.error(f"GraphQL errors: {json.dumps(result['errors'])}")

        return result
    except Exception as e:
        logger.error(f"Error executing AppSync GraphQL: {str(e)}")
        return None
