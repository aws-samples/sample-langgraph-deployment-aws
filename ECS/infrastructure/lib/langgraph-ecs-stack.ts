import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as path from 'path';

export interface LangGraphEcsStackProps extends cdk.StackProps {
  ecrRepositoryName?: string;
  appName: string;
  environment: string;
}

export class LangGraphEcsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: LangGraphEcsStackProps) {
    super(scope, id, props);

    const appName = props.appName;
    const environment = props.environment;

    // VPC with public and private subnets
    const vpc = new ec2.Vpc(this, 'LangGraphVpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        }
      ]
    });

    // SQS dead letter queue
    const deadLetterQueue = new sqs.Queue(this, 'DeadLetterQueue', {
      queueName: `${appName}-${environment}-dlq`,
      retentionPeriod: cdk.Duration.days(14), // Keep failed messages for 14 days
    });

    // Main SQS queue
    const queue = new sqs.Queue(this, 'Queue', {
      queueName: `${appName}-${environment}-queue`,
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: 3, // Move to DLQ after 3 failed processing attempts
      },
      visibilityTimeout: cdk.Duration.minutes(15), // Match with ECS task timeout
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'LangGraphCluster', {
      clusterName: `${appName}-${environment}-cluster`,
      vpc: vpc,
      containerInsights: true,
    });

    // Task role with permissions
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      roleName: `${appName}-${environment}-task-role`,
    });

    // Grant SQS permissions
    queue.grantSendMessages(taskRole);
    queue.grantConsumeMessages(taskRole);
    deadLetterQueue.grantSendMessages(taskRole);

    // Add Bedrock permissions
    taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
      ],
      resources: ['*'],
    }));

    // Create DynamoDB table for LangGraph state
    const stateTable = new dynamodb.Table(this, 'LangGraphStateTable', {
      tableName: `langgraph-${environment}-state`,
      partitionKey: {
        name: 'PK',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'SK',
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Change to RETAIN for production
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl', // Enable TTL for automatic cleanup of old states
    });

    // Add DynamoDB permissions
    taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:BatchGetItem',
        'dynamodb:BatchWriteItem',
        'dynamodb:ConditionCheckItem',
        'dynamodb:DeleteItem',
        'dynamodb:DescribeTable',
        'dynamodb:GetItem',
        'dynamodb:GetRecords',
        'dynamodb:GetShardIterator',
        'dynamodb:PutItem',
        'dynamodb:Query',
        'dynamodb:Scan',
        'dynamodb:UpdateItem'
      ],
      resources: [
        stateTable.tableArn
      ],
      effect: iam.Effect.ALLOW
    }));

    // Task execution role
    const executionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      roleName: `${appName}-${environment}-execution-role`,
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // Build Docker image from local Dockerfile
    const dockerImage = new ecrAssets.DockerImageAsset(this, 'LangGraphImage', {
      directory: path.resolve(__dirname, '../../'),  // Go up two levels to reach the ECS directory
      exclude: ['infrastructure/cdk.out', 'infrastructure/node_modules'],
      platform: ecrAssets.Platform.LINUX_AMD64,
    });

    // Task definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB: 8192,
      cpu: 4096,
      taskRole: taskRole,
      executionRole: executionRole,
      family: `${appName}-${environment}-task`,
    });

    // Create the SSM parameter for Tavily API key from environment variable
    // The environment variable should be loaded by dotenv in the bin/app.ts file
    const tavilyApiKey = process.env.TAVILY_API_KEY;
    
    console.log('Checking for Tavily API key in environment variables...');
    
    if (!tavilyApiKey) {
      console.error('TAVILY_API_KEY environment variable not found!');
      console.error('Make sure you have a .env file in the ECS directory with TAVILY_API_KEY defined');
      throw new Error('TAVILY_API_KEY environment variable not found');
    }
    
    console.log(`Found Tavily API key in environment: ${tavilyApiKey.substring(0, 5)}...`);
    
    const tavilyApiKeyParam = new ssm.StringParameter(this, 'TavilyApiKeyParam', {
      parameterName: '/langgraph/tavily-api-key',
      stringValue: tavilyApiKey,
      description: 'Tavily API Key for LangGraph application',
    });

    // Grant the task execution role access to the parameter
    tavilyApiKeyParam.grantRead(executionRole);

    // Container definition
    // Then, in your container definition, add the secrets property:
    const container = taskDefinition.addContainer('LangGraphContainer', {
      image: ecs.ContainerImage.fromDockerImageAsset(dockerImage),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: `${appName}-${environment}`,
        logRetention: cdk.aws_logs.RetentionDays.ONE_MONTH,
      }),
      environment: {
        'SQS_QUEUE_URL': queue.queueUrl,
        'SQS_DLQ_URL': deadLetterQueue.queueUrl,
        'AWS_REGION': this.region,
        'DYNAMODB_TABLE': `langgraph-${environment}-state`, // Short, unique name without creating the table
        'LOG_LEVEL': 'INFO',
      },
      secrets: {
        'TAVILY_API_KEY': ecs.Secret.fromSsmParameter(tavilyApiKeyParam),
      },
      portMappings: [{ containerPort: 8000 }],
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:8000/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
  });

    // Security group for the Fargate service
    const serviceSecurityGroup = new ec2.SecurityGroup(this, 'ServiceSecurityGroup', {
      vpc,
      description: 'Security group for LangGraph Fargate service',
      allowAllOutbound: true,
    });

    // Security group for the ALB
    const lbSecurityGroup = new ec2.SecurityGroup(this, 'LBSecurityGroup', {
      vpc,
      description: 'Security group for LangGraph ALB',
      allowAllOutbound: true,
    });

    lbSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP traffic from anywhere'
    );

    lbSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS traffic from anywhere'
    );

    // Allow traffic from ALB to Fargate
    serviceSecurityGroup.addIngressRule(
      lbSecurityGroup,
      ec2.Port.tcp(8000),
      'Allow traffic from ALB to Fargate container'
    );

    // Fargate Service
    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition,
      serviceName: `${appName}-${environment}-service`,
      desiredCount: 2,
      minHealthyPercent: 50,
      maxHealthyPercent: 200,
      securityGroups: [serviceSecurityGroup],
      assignPublicIp: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      capacityProviderStrategies: [
        {
          capacityProvider: 'FARGATE',
          weight: 1,
        },
        {
          capacityProvider: 'FARGATE_SPOT',
          weight: 4, // 80% of tasks will use Fargate Spot for cost optimization
        },
      ],
    });

    // Configure auto-scaling
    const scaling = service.autoScaleTaskCount({
      minCapacity: 2,
      maxCapacity: 10,
    });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    scaling.scaleOnMemoryUtilization('MemoryScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    // Application Load Balancer
    const lb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      internetFacing: true,
      securityGroup: lbSecurityGroup,
      loadBalancerName: `${appName}-${environment}-alb`,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    // HTTPS listener with self-signed cert (replace with ACM for production)
    const listener = lb.addListener('Listener', {
      port: 80,
      // For production, use HTTPS:
      // port: 443,
      // certificates: [certificate],
      // sslPolicy: elbv2.SslPolicy.RECOMMENDED,
    });

    // Add target group
    const targetGroup = listener.addTargets('Targets', {
      port: 8000,
      targets: [service],
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyHttpCodes: '200',
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    // API Gateway to provide a clean API endpoint
    const api = new apigateway.RestApi(this, 'ApiGateway', {
      restApiName: `${appName}-${environment}-api`,
      description: 'API Gateway for LangGraph ECS service',
      deployOptions: {
        stageName: 'v0',
        metricsEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
      },
      endpointTypes: [apigateway.EndpointType.REGIONAL],
    });

    // Integration with the ALB
    const integration = new apigateway.HttpIntegration(`http://${lb.loadBalancerDnsName}`, {
      httpMethod: 'ANY',
    });

    // Proxy all requests to the ALB
    const proxyResource = api.root.addResource('{proxy+}');
    const proxyIntegration = new apigateway.HttpIntegration(`http://${lb.loadBalancerDnsName}/{proxy}`, {
      httpMethod: 'ANY',
      options: {
        requestParameters: {
          'integration.request.path.proxy': 'method.request.path.proxy',
        },
      },
    });
    
    proxyResource.addMethod('ANY', proxyIntegration, {
      requestParameters: {
        'method.request.path.proxy': true,
      },
    });

    // Root resource should forward to ALB as well
    api.root.addMethod('ANY', integration);

    // Output the load balancer URL and API Gateway URL
    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: lb.loadBalancerDnsName,
      exportName: `${appName}-${environment}-lb-dns`,
    });

    new cdk.CfnOutput(this, 'ApiGatewayURL', {
      value: api.url,
      exportName: `${appName}-${environment}-api-url`,
    });

    new cdk.CfnOutput(this, 'SQSQueueURL', {
      value: queue.queueUrl,
      exportName: `${appName}-${environment}-sqs-url`,
    });

    new cdk.CfnOutput(this, 'SQSDLQueueURL', {
      value: deadLetterQueue.queueUrl,
      exportName: `${appName}-${environment}-sqs-dlq-url`,
    });

    new cdk.CfnOutput(this, 'DynamoDBTableName', {
      value: stateTable.tableName,
      exportName: `${appName}-${environment}-dynamodb-table`,
    });
  }
}