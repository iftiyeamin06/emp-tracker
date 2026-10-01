import { useEffect, useState } from "react";
import { get } from "../../api/client";
import { fmtDay } from "../../lib/periodOptions";
import { EmptyState, Notice, Skeleton } from "../../components/polish";
import { Card } from "../../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";

interface Employee {
  id: number;
  employee_number: string;
  full_name: string;
}

interface LedgerRow {
  date: string;
  leave_type: string;
  entry_type: string;
  hours: number | string;
  note: string | null;
}

interface LeaveData {
  balances: Record<string, number>;
  ledger: LedgerRow[];
}

interface EmpLeave {
  emp: Employee;
  leave: LeaveData | null;
}

export default function SickHoursPage() {
  const [rows, setRows] = useState<EmpLeave[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    // ponytail: one fetch per employee; fine for roster sizes here, paginate if it ever hurts
    get<{ data: Employee[] }>("/api/employees")
      .then(async (j) => {
        const all = await Promise.all(
          (j.data ?? []).map(async (emp) => {
            try {
              const l = await get<{ data: LeaveData }>(`/api/employees/${emp.id}/leave`);
              return { emp, leave: l.data };
            } catch {
              return { emp, leave: null };
            }
          })
        );
        if (live) {
          setRows(all);
          setLoading(false);
        }
      })
      .catch(() => {
        if (live) {
          setError("Could not load sick history.");
          setLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">Sick Hours</h2>
      {loading && <Skeleton rows={5} cols={4} />}
      {error && <Notice title="Something didn't load" message={error} />}
      {!loading && !error && rows.length === 0 && (
        <EmptyState title="No employees yet" hint="Add employees to see their sick history." />
      )}
      {!loading &&
        !error &&
        rows.map(({ emp, leave }) => {
          const remaining = leave ? Number(leave.balances["SICK_SAFE_PAID"] ?? 0) : null;
          const taken = (leave?.ledger ?? []).filter((l) => String(l.entry_type).toLowerCase() === "usage");
          return (
            <Card key={emp.id} className="p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  {emp.full_name} <span className="font-normal text-muted-foreground">· {emp.employee_number}</span>
                </h3>
                <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  {leave ? `Sick Leave Balance: ${remaining} hrs remaining` : "Leave unavailable"}
                </span>
              </div>
              {taken.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sick days taken.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead>Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {taken.map((l, i) => (
                      <TableRow key={i}>
                        <TableCell>{fmtDay(/^\d{4}-\d{2}-\d{2}$/.test(String(l.note ?? "")) ? l.note : l.date)}</TableCell>
                        <TableCell className="text-right font-medium text-red-600 dark:text-red-400">
                          {Number(l.hours)} hrs
                        </TableCell>
                        <TableCell className="text-muted-foreground">{l.note ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          );
        })}
    </section>
  );
}
