import envSchema from 'env-schema';

const schema = {
  type: 'object',
  required: ['DATABASE_URL', 'GRPC_PARSER_HOST'],
  properties: {
    PORT: { type: 'number', default: 3000 },
    HOST: { type: 'string', default: '0.0.0.0' },
    DATABASE_URL: { type: 'string' },
    REDIS_URL: { type: 'string', default: 'redis://localhost:6379' },
    GRPC_PARSER_HOST: { type: 'string' },
    MAX_FILE_SIZE: { type: 'number', default: 104857600 },
    FILE_RETENTION_HOURS: { type: 'number', default: 24 },
  },
};

interface EnvConfig {
  PORT: number;
  HOST: string;
  DATABASE_URL: string;
  REDIS_URL: string;
  GRPC_PARSER_HOST: string;
  MAX_FILE_SIZE: number;
  FILE_RETENTION_HOURS: number;
}

export const config = envSchema<EnvConfig>({ schema, dotenv: true });
