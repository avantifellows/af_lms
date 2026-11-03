// Points src/lib/db at the e2e test DB, for a spec that runs server code
// (such as an operator script's module) in its own process. Import it before
// anything that imports src/lib/db: the pool reads these when it is created.
Object.assign(process.env, {
  DATABASE_HOST: "localhost",
  DATABASE_PORT: "5432",
  DATABASE_USER: process.env.TEST_DB_USER || "postgres",
  DATABASE_PASSWORD: process.env.TEST_DB_PASSWORD || "postgres",
  DATABASE_NAME: "af_lms_test",
  DATABASE_SSL: "false",
});
