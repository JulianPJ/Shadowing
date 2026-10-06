import { dictionaryId, validateDictionaryIds } from '../dictionary/query';
import { DictionaryValidationError } from '../dictionary/validation';
import type { TagOperation } from './types';
export const TAG_ACCOUNT_MAX = 100;
export const TAG_ENTRY_MAX = 10;
export function tagName(value: unknown) {
  if (typeof value !== 'string') throw new DictionaryValidationError('Invalid tag name');
  const name = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!name || name.length > 64 || /[\u0000-\u001f\u007f]/.test(name))
    throw new DictionaryValidationError('Invalid tag name');
  return { name, normalizedName: name.toLowerCase() };
}
export function validateTagOperation(value: unknown): TagOperation {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new DictionaryValidationError('Invalid tag operation');
  const v = value as Record<string, unknown>;
  const allowed =
    v.action === 'membership'
      ? ['action', 'tagId', 'entryIds', 'remove']
      : v.action === 'delete'
        ? ['action', 'id']
        : ['action', 'id', 'name'];
  if (Object.keys(v).some((k) => !allowed.includes(k)))
    throw new DictionaryValidationError('Invalid tag fields');
  if (v.action === 'membership' && dictionaryId(v.tagId) && typeof v.remove === 'boolean')
    return {
      action: v.action,
      tagId: v.tagId,
      remove: v.remove,
      entryIds: validateDictionaryIds(v.entryIds),
    };
  if (!dictionaryId(v.id)) throw new DictionaryValidationError('Invalid tag ID');
  if (v.action === 'delete') return { action: v.action, id: v.id };
  if (v.action === 'create' || v.action === 'rename')
    return { action: v.action, id: v.id, name: tagName(v.name).name };
  throw new DictionaryValidationError('Invalid tag operation');
}
