import type { KeyMaterial } from '@/lib/crypto';

export type { KeyMaterial };

export type FileKind = 'text' | 'image' | 'video' | 'pdf' | 'binary';

export interface FolderEntry {
  pid: string;
  name: string;
  // hex of XOR-masked folder key (44 bytes -> 88 hex chars)
  keyHex: string;
}

export interface FileEntry {
  pid: string;
  name: string;
  // hex of XOR-masked file key (44 bytes -> 88 hex chars) - legacy 60-byte
  // variant stores original size in bytes [44..52] of the file key.
  keyHex: string;
  kind: FileKind;
  size: number;
  updatedAt: number;
  thumb?: string;
}

export type SortKey = 'name' | 'date' | 'size';
export type ViewMode = 'grid' | 'list';
