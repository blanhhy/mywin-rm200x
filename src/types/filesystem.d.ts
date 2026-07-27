// File System Access API 类型声明
// 浏览器原生支持但 TypeScript DOM lib 尚未收录完整

type FileSystemPermissionMode = 'read' | 'readwrite';

interface FileSystemHandle {
  readonly name: string;
  readonly kind: 'file' | 'directory';
  queryPermission(mode?: FileSystemPermissionMode): Promise<PermissionState>;
  requestPermission(mode?: FileSystemPermissionMode): Promise<PermissionState>;
}
interface FileSystemFileHandle extends FileSystemHandle {
  readonly kind: 'file';
  getFile(): Promise<File>;
  createWritable(options?: FileSystemCreateWritableOptions): Promise<FileSystemWritableFileStream>;
}

interface FileSystemDirectoryHandle extends FileSystemHandle {
  readonly kind: 'directory';
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterable<[string, FileSystemHandle]>;
  keys(): AsyncIterable<string>;
  values(): AsyncIterable<FileSystemHandle>;
}

interface FileSystemCreateWritableOptions {
  keepExistingData?: boolean;
}

type FileSystemWriteChunkType =
  | BufferSource
  | Blob
  | string
  | { type: 'write'; position?: number; data: BufferSource | Blob | string }
  | { type: 'truncate'; size: number }
  | { type: 'seek'; position: number };

interface FileSystemWritableFileStream {
  write(content: FileSystemWriteChunkType): Promise<void>;
  truncate(size: number): Promise<void>;
  seek(position: number): Promise<void>;
  close(): Promise<void>;
}

interface Window {
  showDirectoryPicker(options?: {
    mode?: 'read' | 'readwrite';
    startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
  }): Promise<FileSystemDirectoryHandle>;

  showSaveFilePicker(options?: {
    suggestedName?: string;
    types?: {
      description?: string;
      accept: Record<string, string[]>;
    }[];
  }): Promise<FileSystemFileHandle>;
}
