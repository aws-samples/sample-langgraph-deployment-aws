# LangGraph Agent Workflow Frontend

This is a React frontend application for interacting with the LangGraph agent workflow deployed on AWS AppSync.

## Features

- Start new agent workflows with user input
- Generate and manage workflow IDs on the client side
- Persist workflow state across page refreshes using session storage
- Real-time status updates using AppSync subscriptions
- Send messages to the agent when feedback is required
- View and copy the final results with Markdown formatting

## Getting Started

### Prerequisites

- Node.js and npm installed
- Backend infrastructure deployed (see main README-DEPLOYMENT.md)

### Installation

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file based on the example:

```bash
cp .env.example .env
```

3. Update the `.env` file with your AppSync endpoint and API key:

```
REACT_APP_APPSYNC_ENDPOINT=https://your-appsync-endpoint.appsync-api.region.amazonaws.com/graphql
REACT_APP_AWS_REGION=us-west-2
REACT_APP_APPSYNC_API_KEY=your-api-key-here
```

### Development

Start the development server:

```bash
npm start
```

The application will be available at [http://localhost:3000](http://localhost:3000).

### Production Build

Create a production build:

```bash
npm run build
```

The build artifacts will be stored in the `build/` directory.

## Usage

1. Enter a topic in the input field and click "Start Workflow"
2. The workflow will begin processing asynchronously
3. If the agent requires feedback, a message form will appear
4. Enter your message and click "Send Message"
5. Once complete, the final result will be displayed

## Project Structure

- `src/App.js`: Main application component
- `src/index.js`: Entry point with AWS Amplify configuration
- `src/index.css`: Application styles

## GraphQL Operations

The application uses the following GraphQL operations:

- `startWorkflow`: Mutation to start a new workflow with a client-generated ID
- `sendMessage`: Mutation to send a message for an existing workflow
- `getWorkflowStatus`: Query to check the status of a workflow
- `getWorkflowResult`: Query to retrieve the final result of a completed workflow
- `onWorkflowUpdate`: Subscription for real-time status updates
- `onWorkflowComplete`: Subscription for workflow completion events
