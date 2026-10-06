export type Tag = {
  id: string;
  name: string;
  normalizedName: string;
  createdAt: string;
  updatedAt: string;
};
export type TagOperation =
  | { action: 'create'; id: string; name: string }
  | { action: 'rename'; id: string; name: string }
  | { action: 'delete'; id: string }
  | { action: 'membership'; tagId: string; entryIds: string[]; remove: boolean };
export interface TagRepository {
  list(userId: string): Promise<Tag[]>;
  apply(userId: string, operation: TagOperation): Promise<void>;
}
