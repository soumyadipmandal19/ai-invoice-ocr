import { Fragment } from "react";

// Render a small, safe Markdown subset as React elements. Provider text is never
// interpreted as HTML, scripts, images, or links.
function InlineText({ text }: { text: string }) {
  const tokens = text.split(/(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|(?:[$€£₹¥]\s*[-−]?\d[\d,.]*|\b[A-Z]{3}\s+[-−]?\d[\d,.]*)|\bInvoice\s*#[\w-]+|\b\d+\s+(?:saved\s+)?bills?\b)/g);
  return <>{tokens.map((token, index) => {
    if ((token.startsWith("**") && token.endsWith("**")) || (token.startsWith("__") && token.endsWith("__"))) {
      return <strong key={index} className="font-semibold text-foreground">{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith("`") && token.endsWith("`")) return <code key={index} className="rounded bg-raised px-1 py-0.5 font-mono text-[0.92em] text-body">{token.slice(1, -1)}</code>;
    if (/^(?:[$€£₹¥]|[A-Z]{3}\s+|Invoice\s*#|\d+\s+(?:saved\s+)?bills?\b)/.test(token)) {
      return <strong key={index} className="font-semibold text-foreground tabular-nums">{token}</strong>;
    }
    return <Fragment key={index}>{token}</Fragment>;
  })}</>;
}

type Block = { kind: "paragraph" | "heading"; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: string[] };
const listItem = (line: string) => line.match(/^\s*(?:(\d+)[.)]|([-*•]))\s+(.+)$/);

function blocks(text: string): Block[] {
  const lines = text.replace(/[ \t]*\[S\d+(?:[,\s]+S\d+)*\]/g, "").trim().split(/\r?\n/);
  const result: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!lines[index].trim()) { index++; continue; }
    const heading = lines[index].match(/^#{1,4}\s+(.+)$/);
    if (heading) { result.push({ kind: "heading", text: heading[1] }); index++; continue; }
    const first = listItem(lines[index]);
    if (first) {
      const ordered = !!first[1];
      const items: string[] = [];
      while (index < lines.length) {
        const match = listItem(lines[index]);
        if (match && !!match[1] === ordered) { items.push(match[3]); index++; }
        else if (!lines[index].trim()) {
          let next = index + 1;
          while (next < lines.length && !lines[next].trim()) next++;
          const following = next < lines.length ? listItem(lines[next]) : null;
          if (following && !!following[1] === ordered) index = next;
          else break;
        } else if (match || /^#{1,4}\s/.test(lines[index])) break;
        else { items[items.length - 1] += `\n${lines[index].trim()}`; index++; }
      }
      result.push({ kind: "list", ordered, start: first[1] ? Number(first[1]) : 1, items });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !listItem(lines[index]) && !/^#{1,4}\s/.test(lines[index])) paragraph.push(lines[index++]);
    result.push({ kind: "paragraph", text: paragraph.join("\n") });
  }
  return result;
}

export default function ChatAnswer({ text }: { text: string }) {
  return <div className="space-y-3">{blocks(text).map((block, index) => {
    if (block.kind === "list") {
      const items = block.items.map((item, itemIndex) => <li key={itemIndex} className="pl-1 leading-6 whitespace-pre-wrap"><InlineText text={item} /></li>);
      return block.ordered
        ? <ol key={index} start={block.start} className="list-decimal space-y-3 pl-5 marker:font-semibold marker:text-accent">{items}</ol>
        : <ul key={index} className="list-disc space-y-2 pl-4 marker:text-accent">{items}</ul>;
    }
    return block.kind === "heading"
      ? <p key={index} className="pt-1 font-semibold leading-6 text-foreground"><InlineText text={block.text} /></p>
      : <p key={index} className="leading-6 whitespace-pre-wrap"><InlineText text={block.text} /></p>;
  })}</div>;
}
