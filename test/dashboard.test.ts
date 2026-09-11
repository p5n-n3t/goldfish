import { describe, expect, it } from "vitest";
import { renderDashboard } from "../src/dashboard";

describe("dashboard shell", () => {
  it("shows only explicit unavailable states until analytics are authenticated", () => {
    const html = renderDashboard();

    expect(html).toContain("Project memory, with an honest operational view.");
    expect(html).toContain("Dashboard data is unavailable.");
    expect(html).toContain("Memory records");
    expect(html).toContain("Projects");
    expect(html).toContain("Agents");
    expect(html).toContain("Recent activity");
    expect(html).toContain("Imports");
    expect(html).toContain("Retrieval analytics");
    expect(html).not.toMatch(/\b0\b memories|\b0\b projects|\b0\b agents/i);
  });
});
