import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';

export interface EC2MonitoringStackProps extends cdk.StackProps {
  notificationEmail: string;
}

export class AwsEc2MonitoringCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EC2MonitoringStackProps) {
    super(scope, id, props);

    // Create SNS Topic for alarms
    const topic = new sns.Topic(this, 'EC2MonitoringTopic', {
      displayName: 'EC2 Monitoring Alerts',
    });

    // Add email subscription
    topic.addSubscription(
      new subscriptions.EmailSubscription(props.notificationEmail)
    );

    // Create Lambda function
    const monitoringFunction = new NodejsFunction(this, 'EC2MonitoringFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler',
      entry: path.join(__dirname, '../src/lambda/ec2-monitor.ts'),
      environment: {
        SNS_TOPIC_ARN: topic.topicArn,
      },
      timeout: cdk.Duration.minutes(5),
    });

    // Grant Lambda permissions to manage CloudWatch alarms
    monitoringFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cloudwatch:PutMetricAlarm',
          'cloudwatch:DeleteAlarms',
          'cloudwatch:DescribeAlarms',
        ],
        resources: ['*'],
      })
    );

    // Grant Lambda permissions to use Systems Manager
    monitoringFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'ssm:SendCommand',
          'ssm:GetCommandInvocation',
          'ssm:PutParameter',
          'ssm:GetParameter',
          'ssm:DeleteParameter',
        ],
        resources: ['*'],
      })
    );

    // Grant Lambda permissions to describe EC2 instances
    monitoringFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'ec2:DescribeInstances',
        ],
        resources: ['*'],
      })
    );

    // Grant Lambda permissions to publish to SNS
    topic.grantPublish(monitoringFunction);

    // Create EventBridge rule for EC2 state changes
    const ec2StateRule = new events.Rule(this, 'EC2StateChangeRule', {
      eventPattern: {
        source: ['aws.ec2'],
        detailType: ['EC2 Instance State-change Notification'],
        detail: {
          state: ['running', 'terminated'],
        },
      },
    });

    // Add Lambda as target for the EventBridge rule
    ec2StateRule.addTarget(new targets.LambdaFunction(monitoringFunction));

    // Create IAM role for EC2 instances
    const ec2Role = new iam.Role(this, 'EC2SSMRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
      ],
    });

    // Create instance profile
    const instanceProfile = new iam.CfnInstanceProfile(this, 'EC2InstanceProfile', {
      roles: [ec2Role.roleName],
    });

    // Output the instance profile ARN
    new cdk.CfnOutput(this, 'EC2InstanceProfileARN', {
      value: instanceProfile.attrArn,
      description: 'ARN of the instance profile to attach to EC2 instances',
    });

    // Output the SNS topic ARN
    new cdk.CfnOutput(this, 'SNSTopicARN', {
      value: topic.topicArn,
      description: 'ARN of the SNS topic for monitoring alerts',
    });

    // Output the region
    new cdk.CfnOutput(this, 'Region', {
      value: this.region,
      description: 'Region where the stack is deployed',
    });
  }
}
