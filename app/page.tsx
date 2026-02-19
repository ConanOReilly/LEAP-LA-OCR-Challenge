"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "../src/lib/supabaseClient";

type SampleRow = {
  id: string;
  question_id: string | null;
  label: string | null;
};

export default function HomePage() {
  const [rows, setRows] = useState<SampleRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setErr(null);

      const { data, error } = await supabase
        .from("ocr_samples")
        .select("id, question_id, label")
        .order("created_at", { ascending: false })
        .limit(50);

      if (!alive) return;

      if (error) setErr(error.message);
      else setRows((data ?? []) as SampleRow[]);

      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>OCR Samples</h1>

      {err && <p style={{ color: "crimson" }}>Error: {err}</p>}
      {loading && <p>Loading…</p>}

      {!loading && !err && (
        <div style={{ display: "grid", gap: 10 }}>
          {rows.map((r) => (
            <div
              key={r.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                border: "1px solid #eee",
                borderRadius: 12,
                padding: 12,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}>
                  {r.id}
                </div>
                <div style={{ fontSize: 12, color: "#666" }}>
                  label: {r.label ?? "null"} {r.question_id ? `· qid: ${r.question_id}` : ""}
                </div>
              </div>

              <Link href={`/samples/${r.id}`} style={{ whiteSpace: "nowrap" }}>
                Open →
              </Link>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}



