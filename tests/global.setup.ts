import { MySqlContainer } from "@testcontainers/mysql";
import type { TestProject } from "vitest/node";

async function setup(project: TestProject) {
  const container = await new MySqlContainer("mysql:8.4.8").start();

  project.provide("mysql", {
    host: container.getHost(),
    port: container.getPort(),
    user: "root",
    password: container.getRootPassword(),
  });

  return async () => {
    await container.stop();
  };
}

export { setup };
