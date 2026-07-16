/**
 * Port: publishes events to Redis Streams.
 */
export interface IStreamPublisher {
  // Append an optimize_route event. Returns the stream entry ID.
  publishOptimizeEvent(vehicleId: string, requestId: string, baseRev: number): Promise<string>;
}
