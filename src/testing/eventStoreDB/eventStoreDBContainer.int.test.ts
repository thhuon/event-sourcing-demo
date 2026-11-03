import { jsonEvent } from '@kurrent/kurrentdb-client';
import { randomUUID as uuid } from 'crypto';
import {
  EventStoreDBContainer,
  StartedEventStoreDBContainer,
} from './eventStoreDBContainer';

describe('EventStoreDBContainer', () => {
  jest.setTimeout(180_000);

  let container: StartedEventStoreDBContainer;

  beforeAll(async () => {
    container = await new EventStoreDBContainer().start();
  });

  it('should connect to EventStoreDB and append new event', async () => {
    const client = container.getClient();

    const result = await client.appendToStream(
      `test-${uuid()}`,
      jsonEvent({ type: 'test-event', data: { test: 'test' } }),
    );

    expect(result.success).toBeTruthy();
  });

  afterAll(async () => {
    await container.stop();
  });
});
