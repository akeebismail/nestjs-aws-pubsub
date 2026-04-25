import { SetMetadata } from '@nestjs/common';

export const PUBSUB_HANDLER_OPTIONS = 'PUBSUB_HANDLER_OPTIONS';

export interface PubSubHandlerOptions {
  batch?: boolean;
  retry?: number;
}

/**
 * Binds a handler to a `pattern` and optional PubSub options (e.g. `batch: true` for `PubSubServer`).
 * Uses the same `pattern` metadata key as `@MessagePattern` from `@nestjs/microservices`.
 * `PubSubServer` also reads `PUBSUB_HANDLER_OPTIONS` for batch routing; prefer one decorator style per handler.
 */
export function PubSubMessagePattern(pattern: string, options: PubSubHandlerOptions = {}) {
  return (target: any, key: string, descriptor: PropertyDescriptor) => {
    SetMetadata('pattern', pattern)(target, key, descriptor);
    SetMetadata(PUBSUB_HANDLER_OPTIONS, options)(target, key, descriptor);
  };
} 