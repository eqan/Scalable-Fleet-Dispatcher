import { MongoClient, type Db } from "mongodb";
import { env } from "../../config/env.ts";
import { logger } from "../../shared/logger.ts";

let client: MongoClient | null = null;
let db: Db | null = null;

/**
 * Connect to MongoDB and return the client + database handle.
 * Idempotent -- safe to call multiple times.
 */
export const connectMongo = async (): Promise<{ client: MongoClient; db: Db }> => {
  if (client && db) return { client, db };

  client = new MongoClient(env.MONGO_URI, {
    connectTimeoutMS: 10_000,
    serverSelectionTimeoutMS: 10_000,
  });

  await client.connect();
  db = client.db(env.MONGO_DATABASE);

  logger.info(
    { database: env.MONGO_DATABASE },
    "MongoDB connected",
  );

  return { client, db };
};

/** Get the database handle. Throws if not connected yet. */
export const getMongoDb = (): Db => {
  if (!db) {
    throw new Error("MongoDB not connected. Call connectMongo() first.");
  }
  return db;
};

/** Get the raw MongoClient handle. Throws if not connected yet. */
export const getMongoClient = (): MongoClient => {
  if (!client) {
    throw new Error("MongoDB not connected. Call connectMongo() first.");
  }
  return client;
};

export const disconnectMongo = async (): Promise<void> => {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
};
