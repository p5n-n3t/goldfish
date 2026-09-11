import { describe, expect, it } from "vitest";
import { renderDashboard } from "../src/dashboard";

describe("dashboard shell", () => {
  it("renders an honest unavailable state without fabricating metrics", () => {
    const html = renderDashboard();

    expect(html).toContain("Project memory, with an honest operational view.");
    expect(html).toContain("Dashboard data is unavailable.");
    expect(html).toContain("Memory records");
    expect(html).toContain("Projects");
    expect(html).toContain("Agents");
    expect(html).toContain("Recent activity");
    expect(html).toContain("Imports");
    expect(html).toContain("Retrieval");
    expect(html).not.toMatch(/\b0\b memories|\b0\b projects|\b0\b agents/i);
  });

  it("renders live D1 aggregates when supplied by the Worker", () => {
    const html = renderDashboard({ memoryRecords: 203, projects: 1, agents: 2, imports: 1 });

    expect(html).toContain("Live data.");
    expect(html).toContain("203");
    expect(html).toContain("1 import ledger entries");
    expect(html).toContain("project-scoped lexical search");
    expect(html).not.toContain("Dashboard data is unavailable.");
  });
});
