// File System Access API 类型声明
// 浏览器原生支持但 TypeScript DOM lib 尚未收录完整

type FileSystemPermissionMode = 'read' | 'readwrite';

/** 权限查询/申请的参数描述符（浏览器只接受对象形式，不接受裸字符串） */
interface FileSystemHandlePermissionDescriptor {
  mode?: FileSystemPermissionMode;
}

interface FileSystemHandle {
  readonly name: string;
  readonly kind: 'file' | 'directory';
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
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
