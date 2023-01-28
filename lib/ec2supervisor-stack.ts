import * as cdk from 'aws-cdk-lib';
import {CfnOutput, Duration, RemovalPolicy, Stack} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import {StreamViewType} from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as lambda from 'aws-cdk-lib/aws-lambda';
import {StartingPosition} from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';

import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import {Effect, ManagedPolicy, PolicyStatement, Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";
import * as path from "path";
import * as targets from 'aws-cdk-lib/aws-events-targets';
import {DynamoEventSource, SqsEventSource} from 'aws-cdk-lib/aws-lambda-event-sources';
import {HasStage} from "./shared-props";

export class Ec2SupervisorStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: cdk.StackProps & HasStage) {
        super(scope, id, props);

        // The code that defines your stack goes here

        // example resource


        // SQS queue
        const state_change_sqs = new sqs.Queue(this, 'Ec2SupervisorQueue', {
            visibilityTimeout: cdk.Duration.seconds(300)
        });

        // Dynamodb Tables

        const tb_states = new dynamodb.Table(this, `tb_states-${props.stage}`, {
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: RemovalPolicy.DESTROY,
            pointInTimeRecovery: true,
            stream: StreamViewType.NEW_IMAGE,
            partitionKey: {name: 'instance-id', type: dynamodb.AttributeType.STRING},
            sortKey: {name: 'time', type: dynamodb.AttributeType.STRING},
        });

        // console.log('OneTable table name 👉', table.tableName);
        // console.log('OneTable table arn 👉', table.tableArn);
        //
        // // 👇 add local secondary index
        // table.addLocalSecondaryIndex({
        //   indexName: 'statusIndex',
        //   sortKey: {name: 'status', type: dynamodb.AttributeType.STRING},
        //   projectionType: dynamodb.ProjectionType.ALL,
        // });

        const tb_inventory = new dynamodb.Table(this, `tb_inventory-${props.stage}`, {
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: RemovalPolicy.DESTROY,
            pointInTimeRecovery: true,
            stream: StreamViewType.KEYS_ONLY,
            partitionKey: {name: 'instance-id', type: dynamodb.AttributeType.STRING},
            sortKey: {name: 'time', type: dynamodb.AttributeType.STRING},
        });

        // EC2 state changes
        // # EC2 inventory
        // # IAM policies - AWS managed
        const basic_exec = ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")
        const sqs_access = new ManagedPolicy(this, "LambdaSQSExecution",
            {
                statements: [
                    new PolicyStatement({
                        effect: Effect.ALLOW,
                        actions: [
                            "sqs:ReceiveMessage",
                            "sqs:DeleteMessage",
                            "sqs:GetQueueAttributes"
                        ],
                        resources: [state_change_sqs.queueArn]
                    })]
            })
        const pol_ec2_states_ro = new ManagedPolicy(this, "pol_EC2StatesReadOnly",
            {
                statements: [
                    new PolicyStatement({
                        effect: Effect.ALLOW,
                        actions: [
                            "dynamodb:DescribeStream",
                            "dynamodb:GetRecords",
                            "dynamodb:GetItem",
                            "dynamodb:GetShardIterator",
                            "dynamodb:ListStreams"
                        ],
                        resources: [tb_states.tableArn]
                    })]
            })

        const pol_ec2_states_rwd = new ManagedPolicy(this, "pol_EC2StatesWriteDelete",
            {
                statements: [
                    new PolicyStatement({
                        effect: Effect.ALLOW,
                        actions: [
                            "dynamodb:DeleteItem",
                            "dynamodb:DescribeTable",
                            "dynamodb:PutItem",
                            "dynamodb:Query",
                            "dynamodb:UpdateItem"
                        ],
                        resources: [tb_states.tableArn]
                    })]
            })

        const pol_ec2_inventory_full = new ManagedPolicy(this, "pol_EC2InventoryFullAccess",
            {
                statements: [
                    new PolicyStatement({
                        effect: Effect.ALLOW,
                        actions: [
                            "dynamodb:DeleteItem",
                            "dynamodb:DescribeTable",
                            "dynamodb:GetItem",
                            "dynamodb:PutItem",
                            "dynamodb:Query",
                            "dynamodb:UpdateItem"
                        ],
                        resources: [tb_inventory.tableArn]
                    })]
            })

        const pol_lambda_describe_ec2 = new ManagedPolicy(this, "pol_LambdaDescribeEC2",
            {
                statements: [
                    new PolicyStatement({
                        effect: Effect.ALLOW,
                        actions: [
                            "ec2:Describe*"
                        ],
                        resources: ['*']
                    })]
            })

        //# IAM Roles
        const rl_event_capture = new Role(
            this,
            'rl_state_capture',
            {
                assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [basic_exec, sqs_access, pol_ec2_states_rwd]
            }
        )
        const rl_event_processor = new Role(
            this,
            'rl_state_processor',
            {
                assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [
                    basic_exec,
                    pol_ec2_states_ro,
                    pol_ec2_states_rwd,
                    pol_ec2_inventory_full,
                    pol_lambda_describe_ec2]
            })

        const lambda_event_capture = new lambdaNode.NodejsFunction(this, 'event_capture', {
            runtime: lambda.Runtime.NODEJS_16_X,
            entry: path.join(__dirname, 'lambdas/event_capture/src-ts/index.ts'),
            timeout: Duration.seconds(30),
            memorySize: 2048,
            retryAttempts: 0,
            role: rl_event_capture,
            bundling: {},
            events: [new SqsEventSource(state_change_sqs)],
            environment: {"state_table": tb_states.tableName}
        })

        state_change_sqs.grantConsumeMessages(lambda_event_capture)

        const lambda_event_processor = new lambdaNode.NodejsFunction(this, 'event_processor', {
            runtime: lambda.Runtime.NODEJS_16_X,
            entry: path.join(__dirname, 'lambdas/event_processor/src-ts/index.ts'),
            timeout: Duration.seconds(30),
            memorySize: 2048,
            retryAttempts: 0,
            bundling: {},
            role: rl_event_processor,
            events: [
                new DynamoEventSource(
                    tb_states,
                    {
                        startingPosition: StartingPosition.LATEST
                    })
            ],
            environment: {"inventory_table": tb_inventory.tableName,}
        })

        // # IAM Policies
        //  # IAM Roles
        // # Cloudwatch Event

        const event_ec2_change = new events.Rule(this, 'ec2_state_change', {
            eventPattern: {
                detailType: ["EC2 Instance State-change Notification"],
                detail: {
                    state: [
                        "pending",
                        "running",
                        "stopped",
                        "terminated"]
                },
                source: ["aws.ec2"],
                // resources: [`"arn:aws:ec2:${Stack.of(this).region}:${Stack.of(this).account}:instance/*"`]
            }
        });

        event_ec2_change.addTarget(new targets.SqsQueue(state_change_sqs))

        //  # Outputs
        new CfnOutput(this, "rl_state_capture_arn", {
            value: rl_event_capture.roleArn
        })

        new CfnOutput(this, "rl_state_processor_arn", {
            value: rl_event_processor.roleArn
        })

        new CfnOutput(this, "tb_inventory_arn", {
            value: tb_inventory.tableArn
        })

        new CfnOutput(this, "sqs_state_change", {
            value: state_change_sqs.queueArn
        })

        new CfnOutput(this, "event_ec2_change", {
            value: event_ec2_change.ruleArn
        })

    }
}
