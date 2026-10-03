# Test fixtures

Files here are SYNTHETIC and exist only to exercise the parser, validator and importer.
They are never imported into the public database: the end-to-end test uses the separate
`TEST_DATABASE_URL` database and marks every dataset `isFixture = true`.
