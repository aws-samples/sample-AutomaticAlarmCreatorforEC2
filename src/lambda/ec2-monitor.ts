import * as AWS from 'aws-sdk';

const cloudwatch = new AWS.CloudWatch();
const ssm = new AWS.SSM();
const sns = new AWS.SNS();
const ec2 = new AWS.EC2();

interface AWSError {
  code?: string;
  message?: string;
}

interface InstanceInfo {
  instanceType: string;
  imageId: string;
}

async function getInstanceInfo(instanceId: string): Promise<InstanceInfo> {
  const result = await ec2.describeInstances({
    InstanceIds: [instanceId]
  }).promise();

  const instance = result.Reservations?.[0]?.Instances?.[0];
  if (!instance || !instance.InstanceType || !instance.ImageId) {
    throw new Error(`Could not find instance information for instance ${instanceId}`);
  }

  return {
    instanceType: instance.InstanceType,
    imageId: instance.ImageId
  };
}

async function installCloudWatchAgent(instanceId: string) {
  try {
    // Step 1: Install CloudWatch Agent using Run Command
    const installParams = {
      DocumentName: 'AWS-ConfigureAWSPackage',
      InstanceIds: [instanceId],
      Parameters: {
        'action': ['Install'],
        'name': ['AmazonCloudWatchAgent'],
      }
    };

    console.log('Installing CloudWatch Agent with params:', JSON.stringify(installParams, null, 2));
    const installResult = await ssm.sendCommand(installParams).promise();
    console.log('Install command result:', JSON.stringify(installResult, null, 2));

    // Wait for installation to complete
    if (installResult.Command?.CommandId) {
      await waitForCommandCompletion(instanceId, installResult.Command.CommandId);
    }

    // Step 2: Create default agent configuration
    const configContent = {
      agent: {
        metrics_collection_interval: 60,
        run_as_user: "root"
      },
      metrics: {
        metrics_collected: {
          mem: {
            measurement: [
              "mem_used_percent"
            ],
            metrics_collection_interval: 60
          },
          swap: {
            measurement: [
              "swap_used_percent"
            ]
          }
        },
        append_dimensions: {
          ImageId: "\${aws:ImageId}",
          InstanceId: "\${aws:InstanceId}",
          InstanceType: "\${aws:InstanceType}"
        }
      }
    };

    // Step 3: Create parameter for agent configuration
    const parameterName = `/cloudwatch-agent/config/${instanceId}`;
    await ssm.putParameter({
      Name: parameterName,
      Type: 'String',
      Value: JSON.stringify(configContent),
      Overwrite: true
    }).promise();

    // Step 4: Configure and start the agent
    const configureParams = {
      DocumentName: 'AmazonCloudWatch-ManageAgent',
      InstanceIds: [instanceId],
      Parameters: {
        'action': ['configure'],
        'mode': ['ec2'],
        'optionalConfigurationSource': ['ssm'],
        'optionalConfigurationLocation': [parameterName],
        'optionalRestart': ['yes']
      }
    };

    console.log('Configuring CloudWatch Agent with params:', JSON.stringify(configureParams, null, 2));
    const configureResult = await ssm.sendCommand(configureParams).promise();
    console.log('Configure command result:', JSON.stringify(configureResult, null, 2));

    if (configureResult.Command?.CommandId) {
      await waitForCommandCompletion(instanceId, configureResult.Command.CommandId);
    }

  } catch (error) {
    console.error('Error installing CloudWatch agent:', error);
    throw error;
  }
}

async function waitForCommandCompletion(instanceId: string, commandId: string) {
  const maxAttempts = 30; // 5 minutes with 10-second intervals
  let attempts = 0;

  // Initial delay to allow command invocation to be created
  await new Promise(resolve => setTimeout(resolve, 5000));

  while (attempts < maxAttempts) {
    try {
      const result = await ssm.getCommandInvocation({
        CommandId: commandId,
        InstanceId: instanceId,
      }).promise();

      console.log(`Command status: ${result.Status} for command ${commandId}`);

      if (['Success', 'Complete'].includes(result.Status || '')) {
        return;
      }

      if (['Failed', 'Cancelled', 'TimedOut'].includes(result.Status || '')) {
        throw new Error(`Command failed with status ${result.Status}: ${result.StandardErrorContent}`);
      }

      // Wait 10 seconds before next check
      await new Promise(resolve => setTimeout(resolve, 10000));
      attempts++;
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && (error as AWSError).code === 'InvocationDoesNotExist') {
        console.log(`Waiting for command invocation to be available... (attempt ${attempts + 1}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, 10000));
        attempts++;
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Command timed out after ${maxAttempts * 10} seconds`);
}

async function createAlarms(instanceId: string, snsTopicArn: string) {
  try {
    const instanceInfo = await getInstanceInfo(instanceId);

    // CPU Alarm - 只需要InstanceId维度
    await cloudwatch.putMetricAlarm({
      AlarmName: `CPU-High-${instanceId}`,
      MetricName: 'CPUUtilization',
      Namespace: 'AWS/EC2',
      Period: 60,           // 1分钟
      EvaluationPeriods: 1, // 1个数据点
      DatapointsToAlarm: 1, // 1个数据点超过阈值就触发
      Threshold: 80,
      ActionsEnabled: true,
      AlarmActions: [snsTopicArn],
      ComparisonOperator: 'GreaterThanThreshold',
      TreatMissingData: 'missing',
      Statistic: 'Average',
      Dimensions: [
        {
          Name: 'InstanceId',
          Value: instanceId
        }
      ],
      AlarmDescription: `CPU utilization is high for instance ${instanceId} (>80% for 1 minute)`
    }).promise();

    // Memory Alarm - 需要所有维度
    await cloudwatch.putMetricAlarm({
      AlarmName: `Memory-High-${instanceId}`,
      MetricName: 'mem_used_percent',
      Namespace: 'CWAgent',
      Period: 60,           // 1分钟
      EvaluationPeriods: 1, // 1个数据点
      DatapointsToAlarm: 1, // 1个数据点超过阈值就触发
      Threshold: 75,
      ActionsEnabled: true,
      AlarmActions: [snsTopicArn],
      ComparisonOperator: 'GreaterThanThreshold',
      TreatMissingData: 'missing',
      Statistic: 'Average',
      Dimensions: [
        {
          Name: 'InstanceId',
          Value: instanceId
        },
        {
          Name: 'InstanceType',
          Value: instanceInfo.instanceType
        },
        {
          Name: 'ImageId',
          Value: instanceInfo.imageId
        }
      ],
      AlarmDescription: `Memory utilization is high for instance ${instanceId} (>75% for 1 minute)`
    }).promise();

  } catch (error) {
    console.error('Error creating alarms:', error);
    throw error;
  }
}

async function deleteAlarms(instanceId: string) {
  try {
    await cloudwatch.deleteAlarms({
      AlarmNames: [
        `CPU-High-${instanceId}`,
        `Memory-High-${instanceId}`
      ]
    }).promise();
  } catch (error) {
    console.error('Error deleting alarms:', error);
    throw error;
  }
}

export const handler = async (event: any) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const snsTopicArn = process.env.SNS_TOPIC_ARN;
  if (!snsTopicArn) {
    throw new Error('SNS_TOPIC_ARN environment variable is not set');
  }

  // 检查事件结构
  if (!event.detail || typeof event.detail !== 'object') {
    throw new Error('Invalid event structure: missing or invalid detail object');
  }

  const instanceId = event.detail['instance-id'];
  if (!instanceId) {
    throw new Error('Invalid event structure: missing instance-id');
  }

  const state = event.detail.state;
  if (!state) {
    throw new Error('Invalid event structure: missing state');
  }

  console.log(`Processing EC2 instance ${instanceId} in state ${state}`);

  try {
    if (state === 'running') {
      console.log(`Installing CloudWatch agent on instance ${instanceId}`);
      await installCloudWatchAgent(instanceId);
      
      console.log(`Creating alarms for instance ${instanceId}`);
      await createAlarms(instanceId, snsTopicArn);
    } else if (state === 'terminated') {
      console.log(`Deleting alarms for instance ${instanceId}`);
      await deleteAlarms(instanceId);
    }
  } catch (error) {
    console.error('Error processing EC2 state change:', error);
    throw error;
  }
};
