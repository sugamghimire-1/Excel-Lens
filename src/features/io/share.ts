/**
 * Share links carry the whole workbook, compressed, in the URL fragment.
 * Fragments are never sent to a server, so sharing needs no backend.
 */
import { deserializeWorkbook, isWorkbookJson, serializeWorkbook } from '@/engine/serialize';
import type { Workbook } from '@/types';
import { uid } from '@/utils/id';

const PREFIX = '#w=';
/** Longer links are cut off by many chat and mail apps. */
export const LINK_LIMIT = 60_000;

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function encodeWorkbook(wb: Workbook): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(serializeWorkbook(wb)));
  return toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

export async function decodeWorkbook(text: string): Promise<Workbook> {
  const json = await pipe(fromBase64Url(text), new DecompressionStream('deflate-raw'));
  const data: unknown = JSON.parse(new TextDecoder().decode(json));
  if (!isWorkbookJson(data)) throw new Error('This link does not contain a workbook.');
  // A fresh id keeps the recipient's copy separate from any existing workbook.
  return { ...deserializeWorkbook(data), id: uid('wb') };
}

/** Link to a copy of the workbook, or null when it is too large for a link. */
export async function shareLink(wb: Workbook): Promise<string | null> {
  const body = await encodeWorkbook(wb);
  if (body.length > LINK_LIMIT) return null;
  return `${location.origin}${location.pathname}${PREFIX}${body}`;
}

/** Workbook embedded in the current URL, if any. */
export async function workbookFromUrl(): Promise<Workbook | null> {
  if (!location.hash.startsWith(PREFIX)) return null;
  const body = location.hash.slice(PREFIX.length);
  history.replaceState(null, '', location.pathname + location.search);
  return decodeWorkbook(body);
}
