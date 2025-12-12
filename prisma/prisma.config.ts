import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
    // the main entry for your schema
    schema: 'schema.prisma',

    // where migrations should be generated
    migrations: {
        path: 'migrations',
    },

    // The database URL
    datasource: {
        // Type Safe env() helper
        url: env('DATABASE_URL'),
    },
});

