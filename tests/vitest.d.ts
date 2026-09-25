type MySqlDatabaseConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
};

declare module "vitest" {
  export interface ProvidedContext {
    mysql: MySqlDatabaseConfig;
  }
}

export {};
