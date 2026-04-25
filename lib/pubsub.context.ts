import {BaseRpcContext} from "@nestjs/microservices";

type PubSubContextArgs<P> = [any, P];

export class PubSubContext<P = string> extends BaseRpcContext<PubSubContextArgs<P>> {
    constructor(args: PubSubContextArgs<P>) {
        super(args);
    }

    getMessage(): any {
        return this.args[0];
    }

    getPattern(): P {
        return this.args[1];
    }

    /**
     * Ack: delete the message from the queue when the underlying SQS message exposes `deleteMessage` (e.g. sqs-consumer).
     */
    async ack(): Promise<void> {
        if (typeof this.args[0].deleteMessage === 'function') {
            await this.args[0].deleteMessage();
        }
    }

    /**
     * Nack: default is a no-op. The message becomes visible again after the queue visibility timeout (redelivery).
     * Configure **DLQ** and **redrive** on the queue for poison messages; see AWS SQS dead-letter queue docs.
     */
    async nack(): Promise<void> {
    }
} 