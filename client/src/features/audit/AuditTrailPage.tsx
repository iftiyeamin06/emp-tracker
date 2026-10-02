import { useEffect, useState } from "react";
import { get } from "../../api/client";
import { EmptyState, Notice, Skeleton } from "../../components/polish";
import { Card } from "../../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";

interface AuditRow {
  id: number;
  occurred_at: string;
  actor_user_id: number | null;
  actor_email: string | null;
  actor_name: string | null;
  action: string;
  entity_table: string;
  entity_id: number;
  reason: string | null;
}

const fmtDateTime = (v: unknown): string => {
  const d = new Date(v as any); // local calendar, matching the server (never slice UTC)
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function AuditTrailPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    get<{ data: { rows: AuditRow[] } }>("/api/audit?limit=100")
      .then((j) => {
        if (live) {
          setRows(j.data?.rows ?? []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (live) {
          setError("Could not load the audit trail.");
          setLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">Audit Trail</h2>
      {loading && <Skeleton rows={6} cols={5} />}
      {error && <Notice title="Something didn't load" message={error} />}
      {!loading && !error && rows.length === 0 && (
        <EmptyState title="No audit entries yet" hint="Actions like approvals and edits will appear here." />
      )}
      {!loading && !error && rows.length > 0 && (
        <Card>
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="odd:bg-muted/50">
                  <TableCell className="whitespace-nowrap">{fmtDateTime(r.occurred_at)}</TableCell>
                  <TableCell>{r.actor_email ?? "system"}</TableCell>
                  <TableCell className="font-medium">{r.action}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {r.entity_table} #{r.entity_id}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.reason ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </section>
  );
}
