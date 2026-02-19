"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../src/lib/supabaseClient";

type Sample = {
  id: string;
  question_id: string | null;
  prd: string | null;
  buggy_solution_code: string | null;
  failure_info: any;
  label: string | null;
  meta: any;
};

type CritiqueResponse =
  | {
      ok: true;
      id: string;
      model: string;
      hasAllHeaders?: boolean;
      text: string;
      request_id?: string;
    }
  | {
      ok: false;
      error: string;
      details?: any;
      request_id?: string;
    };

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
      <h2 style={{ marginTop: 0, fontSize: 16 }}>{title}</h2>
      {children}
    </section>
  );
}

function Code({ text }: { text: string }) {
  return (
    <pre
      style={{
        whiteSpace: "pre-wrap",
        margin: 0,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
    >
      {text}
    </pre>
  );
}

function clampText(s: string, max = 12000) {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n\n...[TRUNCATED]";
}

export default function SamplePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [sample, setSample] = useState<Sample | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [critique, setCritique] = useState<CritiqueResponse | null>(null);
  const [critiqueLoading, setCritiqueLoading] = useState(false);

  useEffect(() => {
    if (!id || typeof id !== "string") return;

    let alive = true;

    (async () => {
      setErr(null);
      setSample(null);
      setCritique(null);

      const { data, error } = await supabase
        .from("ocr_samples")
        .select("id, question_id, prd, buggy_solution_code, failure_info, label, meta")
        .eq("id", id)
        .maybeSingle();

      if (!alive) return;

      if (error) {
        setErr(error.message);
        return;
      }

      if (!data) {
        setErr(`No sample found for id: ${id}`);
        return;
      }

      setSample(data as Sample);
    })();

    return () => {
      alive = false;
    };
  }, [id]);

  async function runCritique() {
    if (!sample) return;
    if (!sample.prd || !sample.buggy_solution_code) {
      setCritique({ ok: false, error: "Sample is missing prd or buggy_solution_code" });
      return;
    }

    setCritiqueLoading(true);
    setCritique(null);

    try {
      const res = await fetch("/api/critique", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          id: sample.id,
          prd: sample.prd,
          buggy_solution_code: sample.buggy_solution_code,
          failure_info: sample.failure_info ?? null,
          label: sample.label ?? undefined,
          meta: sample.meta ?? undefined,
        }),
      });

      const data = (await res.json()) as CritiqueResponse;

      if (!res.ok) {
        setCritique({
          ok: false,
          error: (data as any)?.error ?? `Request failed (${res.status})`,
          details: (data as any)?.details ?? null,
          request_id: (data as any)?.request_id,
        });
      } else {
        setCritique(data);
      }
    } catch (e: any) {
      setCritique({ ok: false, error: e?.message ?? "Network error" });
    } finally {
      setCritiqueLoading(false);
    }
  }

  return (
    <main style={{ padding: 24 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <Link href="/">← Back</Link>
        <h1 style={{ margin: 0 }}>Sample {id}</h1>
      </div>

      {err && <p style={{ color: "crimson" }}>Error: {err}</p>}
      {!sample && !err && <p>Loading…</p>}

      {sample && (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              onClick={runCritique}
              disabled={critiqueLoading}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #ddd",
                cursor: critiqueLoading ? "not-allowed" : "pointer",
                background: "white",
              }}
            >
              {critiqueLoading ? "Running…" : "Run Critique"}
            </button>

            {critique && critique.ok && (
              <span style={{ fontSize: 12, color: "#555" }}>
                Model: {critique.model}
                {critique.request_id ? ` · request_id: ${critique.request_id}` : ""}
              </span>
            )}

            {critique && !critique.ok && (
              <span style={{ fontSize: 12, color: "crimson" }}>
                {critique.request_id ? `request_id: ${critique.request_id} · ` : ""}
                {critique.error}
              </span>
            )}
          </div>

          <Block title="PRD (Problem Statement)">
            <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{sample.prd ?? ""}</p>
          </Block>

          <Block title="Label / Judgement">
            <Code text={sample.label ?? ""} />
          </Block>

          <Block title="Buggy solution code">
            <Code text={sample.buggy_solution_code ?? ""} />
          </Block>

          <Block title="Failure info (json)">
            <Code text={clampText(JSON.stringify(sample.failure_info ?? {}, null, 2))} />
          </Block>

          {critique && critique.ok && (
            <Block title="Model Critique Output (3-section contract)">
              <Code text={critique.text ?? ""} />
            </Block>
          )}

          {critique && !critique.ok && critique.details && (
            <Block title="Critique Error Details">
              <Code text={clampText(JSON.stringify(critique.details, null, 2))} />
            </Block>
          )}
        </div>
      )}
    </main>
  );
}


