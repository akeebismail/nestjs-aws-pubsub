import { Reflector } from '@nestjs/core';
import { PUBSUB_HANDLER_OPTIONS, PubSubMessagePattern } from './pubsub.decorator';

describe('PubSubMessagePattern (F-14)', () => {
  class TestController {
    @PubSubMessagePattern('p1', { batch: true })
    m() {
      return;
    }
  }

  it('sets PUBSUB_HANDLER_OPTIONS on the handler', () => {
    const r = new Reflector();
    const opts = r.get(PUBSUB_HANDLER_OPTIONS, TestController.prototype.m);
    expect(opts).toEqual({ batch: true });
  });
});
