import { PrismaClient } from "@prisma/client";
import "dotenv/config";

const url = process.env.HM_USE_TEST_DB === "1" ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL (or TEST_DATABASE_URL with HM_USE_TEST_DB=1) is not set");

export const prisma = new PrismaClient({ datasources: { db: { url } } });
