import { useEffect, useState } from "react";

interface MetaResponse {
  mode: "mock";
  demo: true;
  description: string;
  postsSource: string;
  analysisSource: string;
  liveApiEnabled: false;
}

type MetaState =
  | { status: "loading" }
  | { status: "ok"; meta: MetaResponse }
  | { status: "error"; message: string };

export function App() {
  const [metaState, setMetaState] = useState<MetaState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/meta");
        if (!res.ok) {
          throw new Error(`API returned ${res.status}`);
        }
        const meta = (await res.json()) as MetaResponse;
        if (!cancelled) {
          setMetaState({ status: "ok", meta });
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : "Could not reach local API";
          setMetaState({ status: "error", message });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app">
      <header className="demo-banner" role="status">
        <p className="demo-banner__title">
          Demo mode — fixture posts only; no live API or LLM
        </p>
        <p className="demo-banner__sub">
          This web preview uses local mock data. It does not call Desearch, X, or
          any paid service.
        </p>
      </header>

      <main className="main">
        <h1 className="title">x-analyst (mock foundation)</h1>
        <p className="lede">
          Analyst cards and the analyze form are not built yet. This page only
          confirms the browser can reach the local mock API.
        </p>

        <section className="meta-panel" aria-labelledby="meta-heading">
          <h2 id="meta-heading" className="meta-panel__heading">
            API meta check
          </h2>
          {metaState.status === "loading" && (
            <p className="meta-panel__status">Contacting /api/meta…</p>
          )}
          {metaState.status === "error" && (
            <p className="meta-panel__error" role="alert">
              {metaState.message}. Start the API with{" "}
              <code>npm run dev:server</code>, then run{" "}
              <code>npm run dev:web</code>.
            </p>
          )}
          {metaState.status === "ok" && (
            <dl className="meta-list">
              <div>
                <dt>Mode</dt>
                <dd>{metaState.meta.mode}</dd>
              </div>
              <div>
                <dt>Demo</dt>
                <dd>{metaState.meta.demo ? "yes" : "no"}</dd>
              </div>
              <div>
                <dt>Posts source</dt>
                <dd>{metaState.meta.postsSource}</dd>
              </div>
              <div>
                <dt>Analysis</dt>
                <dd>{metaState.meta.analysisSource}</dd>
              </div>
              <div>
                <dt>Live API</dt>
                <dd>
                  {metaState.meta.liveApiEnabled ? "enabled" : "disabled"}
                </dd>
              </div>
              <div className="meta-list__wide">
                <dt>Description</dt>
                <dd>{metaState.meta.description}</dd>
              </div>
            </dl>
          )}
        </section>
      </main>
    </div>
  );
}
