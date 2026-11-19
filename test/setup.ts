import { env } from 'cloudflare:test';

const schema = (env as unknown as { TEST_SCHEMA: string }).TEST_SCHEMA;
const statements = schema
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')
  .split(';')
  .map((statement) => statement.trim())
  .filter(Boolean);

for (const statement of statements) {
  try {
    await env.DB.prepare(statement).run();
  } catch (error) {
    throw new Error(
      `SQL len=${statement.length} head=${JSON.stringify(statement.slice(0, 80))}: ${String(error)}`,
    );
  }
}
