#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AwsEc2MonitoringCdkStack } from '../lib/aws-ec2-monitoring-cdk-stack';

const app = new cdk.App();

// Get notification email from context
const notificationEmail = app.node.tryGetContext('email');
if (!notificationEmail) {
  throw new Error('Please provide an email address using: cdk deploy -c email=your-email@example.com');
}

new AwsEc2MonitoringCdkStack(app, 'AwsEc2MonitoringCdkStack', {
  notificationEmail: notificationEmail,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
