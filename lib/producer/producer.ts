import {
    SQSClient,
    SendMessageCommand,
} from "@aws-sdk/client-sqs";
import {
    PublishBatchCommand,
    PublishBatchResultEntry,
    PublishCommand,
    SNSClient,
    PublishBatchRequestEntry,
} from "@aws-sdk/client-sns";

import {Message, ProducerOptions, PubSubProducerConfig} from "../pubsub.interface";
import {FailedBatchMessagesError} from "./error";
import {Logger} from "@nestjs/common";

export class Producer {
    private readonly batchSize = 10;
    private sqs: SQSClient;
    private sns: SNSClient;
    protected readonly logger =  new Logger(Producer.name)
    private readonly maxRetries = 3; // Number of retry attempts for sending messages

    constructor(protected options: ProducerOptions, config: PubSubProducerConfig,) {
        this.setup(options,config)
    }

    private setup(option: ProducerOptions, config: PubSubProducerConfig, ) {
        if (option.type === 'sqs') {
            if (option.sqs) {
                this.sqs = option.sqs;
            } else if (option.sqsConfig) {
                this.sqs = new SQSClient(option.sqsConfig);
            } else {
                this.sqs = new SQSClient({
                    endpoint: config.endpoint || undefined,
                    region: config.region,
                    credentials: {
                        secretAccessKey: config.secretKey,
                        accessKeyId: config.accessKey,
                    },
                });
            }
        } else if (option.type === 'sns') {
            if (option.sns) {
                this.sns = option.sns;
            } else if (option.snsConfig) {
                this.sns = new SNSClient(option.snsConfig);
            } else {
                this.sns = new SNSClient({
                    endpoint: config.endpoint || undefined,
                    region: config.region,
                    credentials: {
                        secretAccessKey: config.secretKey,
                        accessKeyId: config.accessKey,
                    },
                });
            }
        }
    }

    public send(message: Message | Message[], retries = this.maxRetries): Promise<any> {
        if (this.options.type == 'sqs') {
            return this.sendMessageWithRetry(this.options.queueUrl, message, retries);
        }

        return this.publicMessage(this.options.topicArn, message, retries);
    }
    protected async publishSnsWithRetry<T = any>(
        topicArn: string,
        data: Message,
        retries: number = this.maxRetries
    ): Promise<void> {
        try {
            const command = new PublishCommand({
                TopicArn: topicArn,
                Message: data.body,
                MessageAttributes: data.messageAttributes,
            });
            await this.sns.send(command);
        } catch (error: any) {
            if (retries <= 0) {
                this.logger.log(
                    `Failed to publish message to SNS after retries: ${error.message}`,
                    'error',
                );
                throw error;
            }
            this.logger.log(
                `Error publishing message to SNS, retrying (${this.maxRetries - retries + 1}/${this.maxRetries}): ${error.message}`,
                'error',
            );
            return this.publishSnsWithRetry(topicArn, data, retries - 1);
        }
    }

    private async sendSNSBatch(
        topicArn: string,
        failedMessages?: string[],
        successfulMessages?: PublishBatchResultEntry[],
        messages?: PublishBatchRequestEntry[],
        startIndex?: number,
    ): Promise<PublishBatchResultEntry[]>  {
        const endIndex = startIndex + this.batchSize;
        const batch = messages.slice(startIndex, endIndex);
        const cmd = new PublishBatchCommand({
            TopicArn: topicArn,
            PublishBatchRequestEntries: batch
        })
        const result = await this.sns.send(cmd)
        const failedMessagesBatch = failedMessages.concat(
            result?.Failed?.map((entry) => entry.Id) || [],
        );
        const successfulMessagesBatch = successfulMessages.concat(
            result?.Successful || [],
        );
        if (endIndex < messages.length) {
            return this.sendSNSBatch(
                topicArn,
                failedMessagesBatch,
                successfulMessagesBatch,
                messages,
                endIndex,
            );
        }
        if (failedMessagesBatch.length === 0) {
            return successfulMessagesBatch;
        }
        throw new FailedBatchMessagesError(failedMessagesBatch);
    }

    /**
     * Sends a message to SQS with retry logic.
     * @param queueUrl
     * @param message - The formatted SQS message.
     * @param retries - The number of retry attempts remaining.
     * @returns A promise that resolves with the SQS response or rejects with an error.
     */
    private async sendMessageWithRetry(
        queueUrl: string,
        message: Message | Message[],
        retries: number,
    ): Promise<any> {
        message = Array.isArray(message) ? message[0] : message;
        try {
            const command = new SendMessageCommand({
                QueueUrl: queueUrl,
                MessageBody: message.body,
                MessageAttributes: message.messageAttributes,
                MessageGroupId: message.groupId,
                MessageDeduplicationId: message.deduplicationId,
                DelaySeconds: message.delaySeconds,
            });

            const result = await this.sqs.send(command);
            this.logger.log(`Producer send result: ${JSON.stringify(result)}`);
            return [result]; // Return as array to match expected type
        } catch (error: any) {
            if (retries <= 0) {
                this.logger.log(
                    `Failed to send message to SQS after retries: ${error.message}`,
                    'error',
                );
                throw error;
            }

            this.logger.log(
                `Error sending message to SQS, retrying (${this.maxRetries - retries + 1}/${this.maxRetries}): ${error.message}`,
                'error',
            );
            // await this.delay(this.retryDelay);
            return this.sendMessageWithRetry(queueUrl, message, retries - 1);
        }
    }

    private publicMessage(topicArn: string, message: Message | Message[], retries: number,): Promise<any> {
        const failedMessages: any = [];
        const successfulMessages: any = [];
        const startIndex = 0;
        const messages = !Array.isArray(message) ? [message] : message;
        try {
            const batches = messages.map(message => ({
                Id: message.id,
                Message: message.body,
                MessageAttributes: message.messageAttributes,
            }))
            return this.sendSNSBatch(topicArn, failedMessages, successfulMessages, batches, startIndex);
        } catch (e) {
            if (e instanceof FailedBatchMessagesError) {
                throw e;
            }
            if (retries > 0) {
                return this.publicMessage(topicArn, message, retries - 1);
            }
            throw e;
        }
    }
}
