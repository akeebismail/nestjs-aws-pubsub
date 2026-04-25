import { SQSClient } from '@aws-sdk/client-sqs';
import { SNSClient } from '@aws-sdk/client-sns';
import { Producer } from './producer';

describe('Producer setup (F-04)', () => {
  const config = { accessKey: 'a', secretKey: 'b', region: 'us-east-1' };

  it('SQS: uses new SQSClient(sqsConfig) when sqsConfig is provided and option.sqs is absent', () => {
    const p = new Producer(
      { name: 'n', type: 'sqs', queueUrl: 'https://test', sqsConfig: { region: 'eu-west-1' } } as any,
      config,
    );
    expect((p as any)['sqs']).toBeInstanceOf(SQSClient);
  });

  it('SNS: uses new SNSClient(snsConfig) when snsConfig is provided and option.sns is absent', () => {
    const p = new Producer(
      { name: 'n', type: 'sns', topicArn: 'arn:aws:sns:eu-west-1:1:t', snsConfig: { region: 'eu-west-1' } } as any,
      config,
    );
    expect((p as any)['sns']).toBeInstanceOf(SNSClient);
  });
});
