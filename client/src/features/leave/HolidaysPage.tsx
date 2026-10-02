import { useEffect, useState } from "react";
import { get } from "../../api/client";
import { fmtDay } from "../../lib/periodOptions";
import { EmptyState, Notice, Skeleton } from "../../components/polish";
import { Card } from "../../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";

interface Day {
  work_date: string;
  day_type: string;
  hours: unknown;
}

interface GridRow {
  employee: { id: number; full_name: string; employee_number: string };
  days: Day[];
}

interface Period {
  id: number;
}

interface HolEntry {
  date: string;
  hours: number;
  kind: string;
}

interface EmpHol {
  emp: { id: number; full_name: string; employee_number: string };
  entries: HolEntry[];
}

export default function HolidaysPage() {
  const [rows, setRows] = useState<EmpHol[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    // ponytail: one grid fetch per period; fine for period counts here, scope to recent periods if it ever hurts
    get<{ data: Period[] }>("/api/pay-periods")
      .then(async (j) => {
        const byEmp = new Map<number, EmpHol>();
        await Promise.all(
          (j.data ?? []).map(async (p) => {
            try {
              const g = await get<{ data: { rows: GridRow[] } }>(`/api/timecards/${p.id}`);
              for (const r of g.data?.rows ?? []) {
                for (const d of r.days ?? []) {
                  if (d.day_type !== "HOLIDAY" && d.day_type !== "HOLIDAY_WORKED") continue;
                  let rec = byEmp.get(r.employee.id);
                  if (!rec) {
                    rec = { emp: r.employee, entries: [] };
                    byEmp.set(r.employee.id, rec);
                  }
                  rec.entries.push({
                    date: fmtDay(d.work_date),
                    hours: Number(d.hours) || 0,
                    kind: d.day_type === "HOLIDAY_WORKED" ? "Worked holiday" : "Holiday",
                  });
                }
              }
            } catch {
              // a single unreadable period must not blank the whole page
            }
          })
        );
        if (live) {
          setRows([...byEmp.values()].sort((a, b) => a.emp.full_name.localeCompare(b.emp.full_name)));
          setLoading(false);
        }
      })
      .catch(() => {
        if (live) {
          setError("Could not load holidays.");
          setLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">Holidays</h2>
      {loading && <Skeleton rows={5} cols={4} />}
      {error && <Notice title="Something didn't load" message={error} />}
      {!loading && !error && rows.length === 0 && (
        <EmptyState title="No holidays recorded yet" hint="Holiday and worked-holiday days will appear here." />
      )}
      {!loading &&
        !error &&
        rows.map(({ emp, entries }) => (
          <Card key={emp.id} className="p-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">
                {emp.full_name} <span className="font-normal text-muted-foreground">· {emp.employee_number}</span>
              </h3>
              <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 font-mono text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                {entries.length} {entries.length === 1 ? "day" : "days"}
              </span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell>{l.date}</TableCell>
                    <TableCell className="text-muted-foreground">{l.kind}</TableCell>
                    <TableCell className="text-right font-mono font-medium tabular-nums">{l.hours} hrs</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        ))}
    </section>
  );
}
