import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AddressCompare } from "./components/AddressCompare";
import { shortAddress } from "./lib/address";
import { DEFAULT_PAGES, loadTransfers, type PageParams } from "./lib/blockscout";
import { DEMO_ADDRESS, loadDemoSnapshot } from "./lib/demo";
import { analyzeTransfers } from "./lib/detect";
import {
  addressUrl,
  FLAG_LABEL,
  formatAmount,
  formatDate,
  formatDay,
  revealSymbol,
  SEVERITY_LABEL,
  txUrl,
} from "./lib/format";
import { summarize } from "./lib/summary";
import type { ClassifiedTransfer, SuspiciousAddress, TokenTransfer, TransferFlag } from "./lib/types";
import { initialAddress, validateInput } from "./lib/ui-state";

const REPO_URL = "https://github.com/ottonielmorais2008-rgb/address-poisoning-detector";

type Source = { kind: "live" } | { kind: "snapshot"; savedAt: string };

interface ScanState {
  address: string;
  transfers: TokenTransfer[];
  next: PageParams | null;
  pages: number;
  source: Source;
}

function relationLabel(s: SuspiciousAddress): string {
  if (!s.match) return "";
  if (s.match.relation === "self") return "Scanned address";
  if (s.match.relation === "other-suspect") return "Other suspect";
  return "Real counterparty";
}

function FlagChips({ flags }: { flags: TransferFlag[] }) {
  return (
    <span className="chips">
      {flags.map((flag) => (
        <span key={flag} className={`chip chip-${flag}`}>
          {FLAG_LABEL[flag]}
        </span>
      ))}
    </span>
  );
}

function SuspectCard({ s }: { s: SuspiciousAddress }) {
  return (
    <article className={`card suspect sev-${s.severity}`}>
      <header className="suspect-head">
        <span className={`pill sev-${s.severity}`}>{SEVERITY_LABEL[s.severity]}</span>
        <a href={addressUrl(s.address)} target="_blank" rel="noreferrer" className="mono">
          {shortAddress(s.address, 8, 6)}
        </a>
        <span className="muted small">
          {s.transferCount} transfer{s.transferCount === 1 ? "" : "s"} · {formatDay(s.firstSeen)} → {formatDay(s.lastSeen)}
        </span>
      </header>
      {s.match && (
        <AddressCompare
          suspect={s.address}
          original={s.match.original}
          prefix={s.match.prefix}
          suffix={s.match.suffix}
          originalLabel={relationLabel(s)}
        />
      )}
      <ul className="reasons">
        {s.reasons.map((r) => (
          <li key={r.flag}>
            <span className={`chip chip-${r.flag}`}>{FLAG_LABEL[r.flag]}</span> {r.text}
          </li>
        ))}
      </ul>
      <p className="small muted">
        Example transaction:{" "}
        <a href={txUrl(s.txHashes[0]!)} target="_blank" rel="noreferrer" className="mono">
          {shortAddress(s.txHashes[0]!, 10, 6)}
        </a>
      </p>
    </article>
  );
}

function TransferRow({ t }: { t: ClassifiedTransfer }) {
  const fake = t.tokenKind === "impersonator";
  return (
    <tr className={t.flags.length ? "flagged" : ""}>
      <td className="nowrap small">{formatDate(t.transfer.timestamp)}</td>
      <td>
        <span className={`dir dir-${t.direction}`}>{t.direction === "in" ? "IN" : "OUT"}</span>
      </td>
      <td>
        <span className={fake ? "token-fake" : t.tokenKind === "official" ? "token-real" : "muted"} title={t.transfer.token.address}>
          {revealSymbol(t.transfer.token.symbol)}
        </span>
      </td>
      <td className="num">{formatAmount(t.amount)}</td>
      <td>
        <a href={addressUrl(t.counterparty)} target="_blank" rel="noreferrer" className="mono">
          {shortAddress(t.counterparty, 6, 4)}
        </a>
      </td>
      <td>
        <FlagChips flags={t.flags} />
      </td>
      <td>
        <a href={txUrl(t.transfer.txHash)} target="_blank" rel="noreferrer" className="small">
          tx ↗
        </a>
      </td>
    </tr>
  );
}

export function App() {
  const start = useMemo(() => initialAddress(window.location.search), []);
  const [input, setInput] = useState(start.address);
  const [scan, setScan] = useState<ScanState | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyFlagged, setOnlyFlagged] = useState(true);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const requestId = useRef(0);

  const analysis = useMemo(() => (scan ? analyzeTransfers(scan.address, scan.transfers) : null), [scan]);

  const runScan = useCallback(async (address: string, options: { keepOnError?: boolean } = {}) => {
    const id = ++requestId.current;
    setLoading("Reading recent token transfers from the public explorer…");
    setError(null);
    setExplanation(null);
    setExplainError(null);
    try {
      const result = await loadTransfers(address, {
        pages: DEFAULT_PAGES,
        onPage: (n) => {
          if (id === requestId.current) setLoading(`Read ${n * 50} transfers…`);
        },
      });
      if (id !== requestId.current) return;
      setScan({ address, transfers: result.transfers, next: result.next, pages: result.pages, source: { kind: "live" } });
      const url = new URL(window.location.href);
      if (address.toLowerCase() === DEMO_ADDRESS.toLowerCase()) url.searchParams.delete("address");
      else url.searchParams.set("address", address);
      window.history.replaceState(null, "", url);
    } catch (e) {
      if (id !== requestId.current) return;
      const message = e instanceof Error ? e.message : "Something went wrong.";
      setError(options.keepOnError ? `Live refresh failed: ${message} Showing the saved snapshot.` : message);
      if (!options.keepOnError) setScan(null);
    } finally {
      if (id === requestId.current) setLoading(null);
    }
  }, []);

  useEffect(() => {
    if (start.isDemo) {
      const demo = loadDemoSnapshot();
      setScan({
        address: demo.address,
        transfers: demo.transfers,
        next: demo.next,
        pages: DEFAULT_PAGES,
        source: { kind: "snapshot", savedAt: demo.savedAt },
      });
      void runScan(DEMO_ADDRESS, { keepOnError: true });
    } else {
      void runScan(start.address);
    }
  }, [start, runScan]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const checked = validateInput(input);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    void runScan(checked.address);
  };

  const loadMore = async () => {
    if (!scan?.next) return;
    const id = ++requestId.current;
    setLoading("Reading older transfers…");
    setError(null);
    try {
      const more = await loadTransfers(scan.address, { pages: DEFAULT_PAGES, start: scan.next });
      if (id !== requestId.current) return;
      setScan({
        ...scan,
        transfers: [...scan.transfers, ...more.transfers],
        next: more.next,
        pages: scan.pages + more.pages,
      });
      setExplanation(null);
    } catch (e) {
      if (id === requestId.current) setError(e instanceof Error ? e.message : "Could not load more.");
    } finally {
      if (id === requestId.current) setLoading(null);
    }
  };

  const explain = async () => {
    if (!analysis) return;
    setExplaining(true);
    setExplainError(null);
    try {
      const response = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary: summarize(analysis) }),
      });
      const body = (await response.json().catch(() => ({}))) as { explanation?: string; error?: string };
      if (!response.ok || !body.explanation) throw new Error(body.error ?? "The explanation is not available right now.");
      setExplanation(body.explanation);
    } catch (e) {
      setExplainError(e instanceof Error ? e.message : "The explanation is not available right now.");
    } finally {
      setExplaining(false);
    }
  };

  const shownTransfers = analysis
    ? (onlyFlagged ? analysis.transfers.filter((t) => t.flags.length > 0) : analysis.transfers).slice(0, 200)
    : [];

  return (
    <div className="page">
      <header className="hero">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            ☣
          </span>
          <div>
            <h1>Address Poisoning Detector</h1>
            <p className="tagline">
              Paste an Ethereum address to find lookalike addresses, fake USDT/USDC tokens, zero-value and dust transfers planted in
              its history.
            </p>
          </div>
        </div>
        <div className="badges">
          <span className="badge">Read-only</span>
          <span className="badge">No wallet connection</span>
          <span className="badge">No keys</span>
          <a className="badge link" href={REPO_URL} target="_blank" rel="noreferrer">
            Source on GitHub ↗
          </a>
        </div>
      </header>

      <form className="search card" onSubmit={onSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="0x… Ethereum address"
          spellCheck={false}
          autoComplete="off"
          aria-label="Ethereum address"
        />
        <button type="submit" disabled={Boolean(loading)}>
          {loading ? "Scanning…" : "Scan"}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            setInput(DEMO_ADDRESS);
            void runScan(DEMO_ADDRESS);
          }}
        >
          Demo address
        </button>
      </form>

      {loading && <p className="status">{loading}</p>}
      {error && <p className="status error">{error}</p>}

      {analysis && scan && (
        <>
          <section className={`card overview sev-${analysis.risk}`}>
            <div className="overview-main">
              <div>
                <p className="muted small">
                  {scan.address.toLowerCase() === DEMO_ADDRESS.toLowerCase() ? "Demo: a real address under attack · " : ""}
                  {scan.source.kind === "live" ? "Live data" : `Saved snapshot from ${formatDate(scan.source.savedAt)}`}
                </p>
                <h2 className="mono break">{scan.address}</h2>
                <p className="muted small">
                  {analysis.transfersScanned} recent ERC-20 transfers scanned · {formatDay(analysis.oldest)} → {formatDay(analysis.newest)}
                </p>
              </div>
              <div className={`risk sev-${analysis.risk}`}>
                <span className="small">Poisoning risk</span>
                <strong>{SEVERITY_LABEL[analysis.risk]}</strong>
              </div>
            </div>
            <div className="stats">
              <div>
                <strong>{analysis.suspicious.length}</strong>
                <span>suspicious addresses</span>
              </div>
              <div>
                <strong>{analysis.counts.lookalike}</strong>
                <span>transfers with lookalikes</span>
              </div>
              <div>
                <strong>{analysis.counts["fake-token"]}</strong>
                <span>fake-token transfers</span>
              </div>
              <div>
                <strong>{analysis.counts["zero-value"]}</strong>
                <span>zero-value transfers</span>
              </div>
              <div>
                <strong>{analysis.counts.dust}</strong>
                <span>dust transfers</span>
              </div>
              <div className={analysis.counts["sent-to-lookalike"] ? "danger" : ""}>
                <strong>{analysis.counts["sent-to-lookalike"]}</strong>
                <span>payments to lookalikes</span>
              </div>
            </div>
            <div className="actions">
              <button type="button" onClick={explain} disabled={explaining}>
                {explaining ? "Explaining…" : "Explain with AI"}
              </button>
              {scan.next && (
                <button type="button" className="ghost" onClick={loadMore} disabled={Boolean(loading)}>
                  Scan 150 older transfers
                </button>
              )}
            </div>
            {explainError && <p className="status error">{explainError}</p>}
            {explanation && (
              <div className="explanation">
                {explanation.split(/\n{2,}/).map((p, i) => (
                  <p key={i}>{p.replace(/\*\*/g, "")}</p>
                ))}
                <p className="small muted">AI-generated from the scan summary only. Check the findings yourself.</p>
              </div>
            )}
          </section>

          <div className="grid">
            <section className="findings">
              <h3>Warnings</h3>
              {analysis.suspicious.length === 0 ? (
                <p className="card muted">
                  No poisoning signs in these transfers. That does not prove the address is safe: older transfers are not scanned
                  unless you load them.
                </p>
              ) : (
                analysis.suspicious.map((s) => <SuspectCard key={s.address} s={s} />)
              )}
            </section>
            <aside className="card trusted">
              <h3>Real counterparties</h3>
              <p className="small muted">Addresses that sent or received at least 1 real USDT/USDC. Lookalikes are compared with these.</p>
              {analysis.trusted.length === 0 ? (
                <p className="muted small">None in the scanned transfers.</p>
              ) : (
                <ul>
                  {analysis.trusted.slice(0, 12).map((c) => (
                    <li key={c.address}>
                      <a href={addressUrl(c.address)} target="_blank" rel="noreferrer" className="mono">
                        {shortAddress(c.address, 8, 6)}
                      </a>
                      <span className="small muted">
                        {c.transfers} transfer{c.transfers === 1 ? "" : "s"}
                        {c.sent > 0 ? ` · sent ${formatAmount(c.sent)}` : ""}
                        {c.received > 0 ? ` · received ${formatAmount(c.received)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <h3>How to stay safe</h3>
              <ul className="tips small">
                <li>Never copy an address from your transaction history.</li>
                <li>Save real addresses in an address book and check every character, not just the start and end.</li>
                <li>Ignore tokens you did not buy, even if they say USDT or USDC.</li>
                <li>Send a small test amount first for large transfers.</li>
              </ul>
            </aside>
          </div>

          <section className="card">
            <div className="table-head">
              <h3>Transfers</h3>
              <label className="small">
                <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} /> Only flagged
              </label>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Dir</th>
                    <th>Token</th>
                    <th className="num">Amount</th>
                    <th>Counterparty</th>
                    <th>Flags</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shownTransfers.map((t) => (
                    <TransferRow key={`${t.transfer.txHash}:${t.transfer.logIndex}`} t={t} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <footer className="footer small muted">
        <p>
          Data: public Blockscout API (Ethereum mainnet), read in your browser. Nothing is signed and no wallet is connected. Only the
          most recent ERC-20 transfers are scanned (150 at a time). Fake tokens are detected by name and contract, not by price data.
          This is an educational tool, not a security guarantee.
        </p>
      </footer>
    </div>
  );
}
