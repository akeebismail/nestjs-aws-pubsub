"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_sqs_1 = require("@aws-sdk/client-sqs");
const client_sns_1 = require("@aws-sdk/client-sns");
const producer_1 = require("./producer");
describe('Producer setup (F-04)', () => {
    const config = { accessKey: 'a', secretKey: 'b', region: 'us-east-1' };
    it('SQS: uses new SQSClient(sqsConfig) when sqsConfig is provided and option.sqs is absent', () => {
        const p = new producer_1.Producer({ name: 'n', type: 'sqs', queueUrl: 'https://test', sqsConfig: { region: 'eu-west-1' } }, config);
        expect(p['sqs']).toBeInstanceOf(client_sqs_1.SQSClient);
    });
    it('SNS: uses new SNSClient(snsConfig) when snsConfig is provided and option.sns is absent', () => {
        const p = new producer_1.Producer({ name: 'n', type: 'sns', topicArn: 'arn:aws:sns:eu-west-1:1:t', snsConfig: { region: 'eu-west-1' } }, config);
        expect(p['sns']).toBeInstanceOf(client_sns_1.SNSClient);
    });
});
//# sourceMappingURL=producer.spec.js.map