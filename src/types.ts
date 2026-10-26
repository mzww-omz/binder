export interface Binder {
  id: string;
  title: string;
  created_at: number;
  expires_at: number;
  updated_at: number;
}
export interface BinderNode {
  id: string;
  binder_id: string;
  parent_id: string | null;
  type: 'folder' | 'link';
  title: string;
  url: string | null;
  sort_order: number;
  metadata_status?: 'none' | 'pending' | 'ready' | 'failed';
  favicon_url?: string | null;
  created_at: number;
  updated_at: number;
}
export interface BinderData extends Binder { nodes: BinderNode[] }
