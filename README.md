# sample-AutomaticAlarmCreatorforEC2

This CDK project implements automated EC2 instance monitoring with the following features:

- Automatically installs CloudWatch Agent on newly created EC2 instances
- Creates CloudWatch alarms for CPU and Memory utilization
- Sends email notifications when thresholds are exceeded
- Automatically cleans up alarms when instances are terminated

## Architecture

The solution includes:

- EventBridge rule to monitor EC2 instance state changes
- Lambda function to handle instance creation/termination events
- Systems Manager automation for CloudWatch Agent installation
- CloudWatch alarms for monitoring metrics
- SNS topic for email notifications
- IAM roles and policies for secure operation

## Prerequisites

1. AWS CDK CLI installed
2. Node.js 18.x or later
3. AWS CLI configured with appropriate credentials
4. An AWS account with sufficient permissions

## Alarm Thresholds

- CPU Utilization: > 80% for 1 consecutive 1-minute periods
- Memory Usage: > 75% for 1 consecutive 1-minute periods
> You can modify these thresholds or add more alarms in `src/lambda/ec2-monitor.ts`.

## Deployment Instructions

1. Clone the repository and navigate to the project directory:
   ```bash
   cd sample-AutomaticAlarmCreatorforEC2
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Deploy the stack with your notification email:
   ```bash
   cdk deploy -c email=your-email@example.com
   ```

4. Confirm the SNS topic subscription in your email

## Using with EC2 Instances

When launching new EC2 instances, make sure to:

1. Use the Instance Profile ARN output from the stack deployment
2. The instance must have internet connectivity to communicate with Systems Manager
3. Ensure the instance has the SSM Agent installed (comes pre-installed on Amazon Linux 2)

## Cleanup

To remove all resources:

```bash
cdk destroy
```

## Stack Outputs

The stack provides two important outputs:

1. `EC2InstanceProfileARN` - Use this when launching EC2 instances
2. `SNSTopicARN` - The ARN of the SNS topic where alerts are sent

## Monitoring Details

The stack monitors the following:

- EC2 instance state changes (running/terminated)
- CPU utilization (threshold: 80%)
- Memory utilization (threshold: 75%)

When an instance enters the 'running' state:
1. CloudWatch Agent is automatically installed via Systems Manager
2. CPU and Memory alarms are created

When an instance is terminated:
- All associated alarms are automatically cleaned up

## Troubleshooting

1. Check CloudWatch Logs for Lambda function execution logs
2. Verify Systems Manager Run Command history for CloudWatch Agent installation
3. Ensure EC2 instances have proper IAM roles and internet connectivity
4. Confirm SNS topic subscription is confirmed

## Security

The solution implements least-privilege security principles:
- Lambda functions have minimal required permissions
- EC2 instances use instance profiles with specific permissions
- All resources use AWS-managed policies where appropriate

## Command Line Parameters

The stack requires one parameter during deployment:

- `email`: The email address where monitoring notifications will be sent
  ```bash
  cdk deploy -c email=your-email@example.com
  ```

If you try to deploy without providing an email address, the deployment will fail with an error message asking you to provide one.


## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.
