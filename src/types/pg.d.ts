declare module 'pg' {
  export type PoolConfig = {
    connectionString?: string;
    max?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
    keepAlive?: boolean;
    keepAliveInitialDelayMillis?: number;
    ssl?: false | { rejectUnauthorized?: boolean };
  };

  export class Pool {
    constructor(config?: PoolConfig);
    on(event: 'error', listener: (error: Error) => void): this;
    end(): Promise<void>;
  }
}
