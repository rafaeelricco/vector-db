import "tsconfig-paths/register"; // enable absolute paths
import "reflect-metadata"; // enable decorators

import express from "express";
import cors from "cors";

async function main() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (req, res) => { res.status(200).send("OK"); });
}

await main();
