#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { LangGraphEcsStack } from '../lib/langgraph-ecs-stack';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env file
const envPath = path.resolve(__dirname, '../../.env');
console.log(`Loading environment variables from: ${envPath}`);
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.error(`Error loading .env file: ${result.error.message}`);
  process.exit(1);
}

console.log('Environment variables loaded successfully');
console.log(`TAVILY_API_KEY present: ${process.env.TAVILY_API_KEY ? 'Yes' : 'No'}`);

const app = new cdk.App();

new LangGraphEcsStack(app, 'LangGraphEcsStack', {
  appName: 'langgraph',
  environment: app.node.tryGetContext('environment') || 'dev',
  ecrRepositoryName: app.node.tryGetContext('ecrRepositoryName'),
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-west-2',
  },
});
