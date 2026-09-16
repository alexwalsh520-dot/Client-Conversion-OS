import { describe, expect, it } from "vitest";
import { computeChurnMonth, churnSlackText, previousMonthStart } from "./stripe-churn";

const T = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

describe("computeChurnMonth", () => {
  const subs = [
    { id: "a", status: "active", created: T("2026-06-10T00:00:00Z"), endedAt: null },
    { id: "b", status: "canceled", created: T("2026-06-20T00:00:00Z"), endedAt: T("2026-08-15T00:00:00Z") },
    { id: "c", status: "unpaid", created: T("2026-07-01T00:00:00Z"), endedAt: T("2026-08-03T00:00:00Z") },
    { id: "d", status: "active", created: T("2026-08-12T00:00:00Z"), endedAt: null },
    { id: "e", status: "canceled", created: T("2026-08-05T00:00:00Z"), endedAt: T("2026-08-20T00:00:00Z") },
    { id: "f", status: "canceled", created: T("2026-05-01T00:00:00Z"), endedAt: T("2026-07-09T00:00:00Z") },
  ];
  const now = new Date("2026-09-16T00:00:00Z");

  it("counts alive at start, canceled + unpaid in month, new, and end", () => {
    const c = computeChurnMonth(subs, "2026-08-01", now);
    expect(c.startActive).toBe(3); // a, b, c (f already gone in July)
    expect(c.canceled).toBe(2); // b and e (e joined and left inside August)
    expect(c.unpaid).toBe(1); // c
    expect(c.churned).toBe(3);
    expect(c.newSubs).toBe(2); // d, e
    expect(c.churnRatePct).toBe(100); // 3 / 3
    expect(c.endActive).toBe(2); // a, d
    expect(c.partial).toBe(false);
    expect(c.monthLabel).toBe("August 2026");
  });

  it("marks the running month partial and uses now as its end", () => {
    const c = computeChurnMonth(subs, "2026-09-01", now);
    expect(c.partial).toBe(true);
    expect(c.startActive).toBe(2);
    expect(c.churned).toBe(0);
    expect(c.churnRatePct).toBe(0);
  });

  it("previousMonthStart rolls over the year", () => {
    expect(previousMonthStart(new Date("2026-01-01T02:30:00Z"))).toBe("2025-12-01");
    expect(previousMonthStart(new Date("2026-10-01T02:30:00Z"))).toBe("2026-09-01");
  });

  it("slack text carries the rate and the plain sentences", () => {
    const text = churnSlackText(computeChurnMonth(subs, "2026-08-01", now));
    expect(text).toContain("Churn rate: *100.0%*");
    expect(text).toContain("We started August 2026 with 3 paying subscribers.");
    expect(text).toContain("2 canceled on purpose.");
  });
});
