/**
 * Port: consumes messages from a Redis Stream via consumer groups.
 */
export interface StreamMessage<T = Record<string, string>> {
  id: string;
  data: T;
}

export interface IStreamConsumer {
  // Start the blocking consume loop. Calls handler for each message.
  consume(handler: (message: StreamMessage) => Promise<void>): Promise<void>;

  // Signal the consumer to stop gracefully.
  stop(): void;
}
