import { splitForHighlight } from "../lib/format";

export function HighlightedAddress({ address, prefix, suffix }: { address: string; prefix: number; suffix: number }) {
  const [ox, start, middle, end] = splitForHighlight(address, prefix, suffix);
  return (
    <code className="addr">
      <span className="addr-dim">{ox}</span>
      <mark>{start}</mark>
      <span className="addr-mid">{middle}</span>
      <mark>{end}</mark>
    </code>
  );
}

export function AddressCompare({
  suspect,
  original,
  prefix,
  suffix,
  originalLabel,
}: {
  suspect: string;
  original: string;
  prefix: number;
  suffix: number;
  originalLabel: string;
}) {
  return (
    <div className="compare">
      <div className="compare-row">
        <span className="compare-label bad">Suspicious</span>
        <HighlightedAddress address={suspect} prefix={prefix} suffix={suffix} />
      </div>
      <div className="compare-row">
        <span className="compare-label good">{originalLabel}</span>
        <HighlightedAddress address={original} prefix={prefix} suffix={suffix} />
      </div>
    </div>
  );
}
