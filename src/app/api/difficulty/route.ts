import { handleDifficultyRequest } from '@/lib/difficulty-api';
export const maxDuration = 40;
export async function POST(request: Request) { return handleDifficultyRequest(request); }
